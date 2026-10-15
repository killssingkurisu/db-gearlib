import com.jpexs.decompiler.flash.SWF;
import com.jpexs.decompiler.flash.exporters.FrameExporter;
import com.jpexs.decompiler.flash.exporters.modes.FrameExportMode;
import com.jpexs.decompiler.flash.exporters.settings.FrameExportSettings;
import com.jpexs.decompiler.flash.tags.DefineSpriteTag;
import com.jpexs.decompiler.flash.tags.FrameLabelTag;
import com.jpexs.decompiler.flash.tags.ShowFrameTag;
import com.jpexs.decompiler.flash.tags.Tag;
import com.jpexs.decompiler.flash.tags.base.CharacterTag;
import com.jpexs.decompiler.flash.tags.base.PlaceObjectTypeTag;
import com.jpexs.decompiler.flash.tags.base.ShapeTag;
import com.jpexs.decompiler.flash.types.FILLSTYLE;
import com.jpexs.decompiler.flash.types.FILLSTYLEARRAY;
import com.jpexs.decompiler.flash.types.RGB;
import com.jpexs.decompiler.flash.types.SHAPEWITHSTYLE;
import com.jpexs.decompiler.flash.types.shaperecords.SHAPERECORD;
import com.jpexs.decompiler.flash.types.shaperecords.StyleChangeRecord;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Draws Dungeon Blitz mounts the way the client's SuperAnimData does, with the JPEXS FFDec
 * library (ffdec_lib): every part on the rig frame whose class is X is swapped for X_<set>,
 * trying the entity's CustomArt sets from the last to the first; then every solid fill whose
 * colour is a ColorSwap key takes the new colour. The rig's fire socket (an attachment marker
 * the game never shows) is left out.
 *
 * Jobs file (tools/mounts/mount_jobs.py --jobs), one per line, tab separated:
 *   outName  rigSwf  frameLabel  set1,set2,...  RRGGBB=RRGGBB;RRGGBB=RRGGBB
 *
 *   javac -cp "ffdec_lib.jar:lib/*" -d out Mount.java
 *   java -cp "out:ffdec_lib.jar:lib/*" Mount jobs.tsv <render dir> 2
 *
 * Writes <render dir>/<outName>/DefineSprite_<id>_a__Animation/<frame>.png on the whole stage;
 * tools/mounts/frame_images.py crops and centres them.
 */
public class Mount {
    static Map<String, byte[]> rigs = new HashMap<>();

    static SWF load(String path) throws Exception {
        byte[] b = rigs.get(path);
        if (b == null) {
            b = Files.readAllBytes(new File(path).toPath());
            rigs.put(path, b);
        }
        return new SWF(new ByteArrayInputStream(b), path, new File(path).getName(), null, false, false, true);
    }

    static void reach(SWF swf, int id, Set<Integer> seen) {
        if (!seen.add(id)) return;
        CharacterTag t = swf.getCharacter(id);
        if (t instanceof DefineSpriteTag) {
            for (Tag tg : ((DefineSpriteTag) t).getTags()) {
                if (tg instanceof PlaceObjectTypeTag) {
                    int c = ((PlaceObjectTypeTag) tg).getCharacterId();
                    if (c > 0) reach(swf, c, seen);
                }
            }
        }
    }

    static int swapFills(FILLSTYLEARRAY arr, Map<Integer, Integer> swaps) {
        int n = 0;
        if (arr == null || arr.fillStyles == null) return 0;
        for (FILLSTYLE fs : arr.fillStyles) {
            if (fs.fillStyleType == FILLSTYLE.SOLID && fs.color != null) {
                int rgb = (fs.color.red << 16) | (fs.color.green << 8) | fs.color.blue;
                Integer to = swaps.get(rgb);
                if (to != null) {
                    fs.color.red = (to >> 16) & 255;
                    fs.color.green = (to >> 8) & 255;
                    fs.color.blue = to & 255;
                    n++;
                }
            }
        }
        return n;
    }

    public static void main(String[] a) throws Exception {
        String out = a[1];
        double zoom = Double.parseDouble(a[2]);
        for (String line : Files.readAllLines(new File(a[0]).toPath())) {
            if (line.isBlank()) continue;
            String[] f = line.split("\t", -1);
            String name = f[0], rig = f[1], label = f[2];
            String[] sets = f[3].isEmpty() ? new String[0] : f[3].split(",");
            Map<Integer, Integer> swaps = new HashMap<>();
            if (!f[4].isEmpty()) {
                for (String s : f[4].split(";")) {
                    String[] kv = s.split("=");
                    swaps.put(Integer.parseInt(kv[0], 16), Integer.parseInt(kv[1], 16));
                }
            }
            SWF swf = load(rig);
            DefineSpriteTag anim = (DefineSpriteTag) swf.getCharacterByClass("a__Animation");
            int frame = -1, fr = 0;
            for (Tag tg : anim.getTags()) {
                if (tg instanceof FrameLabelTag && ((FrameLabelTag) tg).getLabelName().equals(label) && frame < 0) frame = fr;
                if (tg instanceof ShowFrameTag) fr++;
            }
            if (frame < 0) throw new RuntimeException(name + ": no frame " + label);
            // The fire socket is an attachment marker the game hides; leave it out.
            List<Tag> sockets = new ArrayList<>();
            for (Tag tg : anim.getTags()) {
                if (tg instanceof PlaceObjectTypeTag) {
                    int c = ((PlaceObjectTypeTag) tg).getCharacterId();
                    if (c > 0 && swf.getCharacter(c).getClassNames().contains("a_FireSocket")) sockets.add(tg);
                }
            }
            for (Tag tg : sockets) anim.removeTag(tg);
            // Part swaps
            StringBuilder log = new StringBuilder();
            Map<Integer, Integer> replaced = new HashMap<>();
            for (Tag tg : anim.getTags()) {
                if (!(tg instanceof PlaceObjectTypeTag)) continue;
                PlaceObjectTypeTag p = (PlaceObjectTypeTag) tg;
                int c = p.getCharacterId();
                if (c <= 0) continue;
                Integer r = replaced.get(c);
                if (r == null) {
                    r = c;
                    CharacterTag ch = swf.getCharacter(c);
                    for (String cls : ch.getClassNames()) {
                        for (int i = sets.length - 1; i >= 0; i--) {
                            CharacterTag alt = swf.getCharacterByClass(cls + "_" + sets[i]);
                            if (alt != null) {
                                r = alt.getCharacterId();
                                log.append(cls).append("->").append(sets[i]).append(' ');
                                break;
                            }
                        }
                    }
                    replaced.put(c, r);
                }
                if (r != c) {
                    p.setCharacterId(r);
                    tg.setModified(true);
                }
            }
            // Colour swaps on every shape the rig can show
            int recolored = 0;
            if (!swaps.isEmpty()) {
                Set<Integer> seen = new HashSet<>();
                for (int r : replaced.values()) reach(swf, r, seen);
                for (int id : seen) {
                    CharacterTag t = swf.getCharacter(id);
                    if (!(t instanceof ShapeTag)) continue;
                    ShapeTag st = (ShapeTag) t;
                    SHAPEWITHSTYLE sh = st.getShapes();
                    int n = swapFills(sh.fillStyles, swaps);
                    for (SHAPERECORD rec : sh.shapeRecords) {
                        if (rec instanceof StyleChangeRecord) n += swapFills(((StyleChangeRecord) rec).fillStyles, swaps);
                    }
                    if (n > 0) st.setModified(true);
                    recolored += n;
                }
            }
            swf.clearAllCache();
            anim.resetTimeline();
            String dir = out + File.separator + name;
            new File(dir).mkdirs();
            List<Integer> frames = new ArrayList<>();
            frames.add(frame);
            new FrameExporter().exportFrames(null, dir, swf, anim.getCharacterId(), frames, 1,
                    new FrameExportSettings(FrameExportMode.PNG, zoom, true, 1), null);
            System.out.println(name + " frame " + frame + " fills " + recolored + " parts " + log);
        }
        System.exit(0);
    }
}
