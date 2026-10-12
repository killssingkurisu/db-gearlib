/**
 * Reads the two drop-location tables compiled into DungeonBlitz.swf:
 *   var_22  boss name        -> dungeon level   (boss gear)
 *   var_32  realm + level    -> dungeon level   (realm gear from lieutenants and mini-bosses)
 * The same tables the Dungeon Blitz R server reads in GameData.loadGearDropLocationMaps.
 *
 * Run from tools/extract_drops.py (it passes the server's swfPatchUtils.ts):
 *   npx tsx tools/swf-drop-locations.ts <swfPatchUtils.ts> <DungeonBlitz.swf> <out.json>
 */
import * as fs from 'fs';
import * as path from 'path';

const [utilsPath, swfPath, outPath] = process.argv.slice(2);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { disassemble, parseAbc, parseSwf } = require(path.resolve(utilsPath));

const swf = parseSwf(swfPath);
const abc = parseAbc(swf);
const operand = (ins: { operands?: Array<[string, number]> }): number => (ins.operands && ins.operands[0] ? ins.operands[0][1] : -1);

const out: { map: string; key: string; level: string }[] = [];
for (const mb of abc.methodBodies.values()) {
    const code = swf.body.subarray(mb.codeStart, mb.codeStart + mb.codeLen);
    let ins: Array<{ opcode: number; operands?: Array<[string, number]> }>;
    try { ins = disassemble(code, 'drop-locations'); } catch { continue; }
    // getlex var_xx; pushstring key; pushstring level; setproperty
    for (let i = 0; i + 3 < ins.length; i++) {
        if (ins[i].opcode !== 0x60 || ins[i + 1].opcode !== 0x2c || ins[i + 2].opcode !== 0x2c || ins[i + 3].opcode !== 0x61) continue;
        const map = abc.multinameNames[operand(ins[i])] ?? '';
        if (map !== 'var_22' && map !== 'var_32') continue;
        out.push({ map, key: abc.stringValues[operand(ins[i + 1])] ?? '', level: abc.stringValues[operand(ins[i + 2])] ?? '' });
    }
}
fs.writeFileSync(outPath, JSON.stringify(out));
console.log('drop locations: %d boss, %d realm', out.filter((o) => o.map === 'var_22').length, out.filter((o) => o.map === 'var_32').length);
