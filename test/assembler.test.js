// 使い方: node test/assembler.test.js
// index.html の <script id="assembler"> と <script id="simulator"> を取り出して、
// MIPS32 のエンコーディング・命令の意味・パイプラインの動作と一致するかを検証する。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const ctx = {};
vm.createContext(ctx);
['assembler', 'simulator'].forEach(id => {
  const m = new RegExp('<script id="' + id + '">([\\s\\S]*?)</script>').exec(html);
  if (!m) throw new Error(id + ' script not found in index.html');
  vm.runInContext(m[1], ctx);
});
const { assemble } = ctx.MipsAssembler;
const Sim = ctx.MipsSimulator;

let failed = 0, passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log('FAIL: ' + name + (detail ? '\n      ' + detail : ''));
}

function hexes(src, start) {
  const r = assemble(src, start === undefined ? {} : { startAddress: start });
  return { hex: r.words.map(w => w.hex), r };
}

function expectHex(name, src, expected, start) {
  const { hex, r } = hexes(src, start);
  check(name + ' (no errors)', r.errors.length === 0, JSON.stringify(r.errors));
  check(name, JSON.stringify(hex) === JSON.stringify(expected),
    'expected ' + expected.join(' ') + '\n      actual   ' + hex.join(' '));
}

const h0 = v => (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
function expectError(name, src, pattern) {
  const r = assemble(src, {});
  check(name, r.errors.some(e => pattern.test(e.message)), JSON.stringify(r.errors));
}

// --- 基本的なプログラム（既定の配置先 0x00400000） ---
expectHex('レジスタとメモリ', `
ADDI $8, $0, 0x7A
ADDI $9, $0, 0x95
ADD  $10, $8, $9
LUI  $11, 0x1001
SW   $10, 0($11)
LW   $12, 0($11)`,
['2008007A', '20090095', '01095020', '3C0B1001', 'AD6A0000', '8D6C0000']);

expectHex('シフトとループ', `
START: ADDI $8,$0,1
LOOP:  SLL $8,$8,1
       BNE $8,$0, LOOP
       J START`,
['20080001', '00084040', '1500FFFE', '08100000']);

expectHex('配列の総和', `
       ADD $8,$0,$0
       LUI $9,0x1001
LOOP:  LW $10,0($9)
       BEQ $10,$0,HALT
       ADD $8,$8,$10
       ADDI $9,$9,4
       J LOOP
HALT:  J HALT`,
['00004020', '3C091001', '8D2A0000', '11400003', '010A4020', '21290004', '08100002', '08100007']);

expectHex('LW / SW', 'LW $9,8($8)\nSW $9,8($8)', ['8D090008', 'AD090008']);
expectHex('BEQ 前方', 'BEQ $8, $9, NEXT\nNOP\nNOP\nNEXT: NOP', ['11090002', '00000000', '00000000', '00000000']);

// --- 各命令 ---
expectHex('R形式', `
SUB $3,$1,$2
AND $3,$1,$2
OR $3,$1,$2
XOR $3,$1,$2
SLT $3,$1,$2
SRL $3,$2,4
JR $ra
MULT $1,$2
DIV $1,$2
MFHI $3
MFLO $3
MTHI $1
MTLO $1
ADDU $3,$1,$2
SUBU $3,$1,$2`,
['00221822', '00221824', '00221825', '00221826', '0022182A', '00021902', '03E00008',
 '00220018', '0022001A', '00001810', '00001812', '00200011', '00200013', '00221821', '00221823']);

expectHex('I形式', `
ANDI $t0,$t1,0xFF
ORI $t0,$t1,0xFFFF
XORI $t0,$t1,1
SLTI $t0,$t1,-1
ADDI $sp,$sp,-8
LB $t0,-4($sp)
LBU $t0,1($sp)
SB $t0,($sp)
ADDIU $sp,$sp,-8`,
['312800FF', '3528FFFF', '39280001', '2928FFFF', '23BDFFF8', '83A8FFFC', '93A80001', 'A3A80000', '27BDFFF8']);

expectHex('R形式（追加分）', `
NOR $3,$1,$2
SLTU $3,$1,$2
SRA $3,$2,4
SLLV $3,$2,$1
SRLV $3,$2,$1
SRAV $3,$2,$1
MULTU $1,$2
DIVU $1,$2
JALR $t9
JALR $8, $9`,
['00221827', '0022182B', '00021903', '00221804', '00221806', '00221807', '00220019', '0022001B', '0320F809', '01204009']);

expectHex('I形式（追加分）', `
SLTIU $t0,$t1,-1
LH $t0,2($sp)
LHU $t0,2($sp)
SH $t0,2($sp)`,
['2D28FFFF', '87A80002', '97A80002', 'A7A80002']);

expectHex('0 と比較する分岐', `
L: BLEZ $8, L
BGTZ $8, L
BLTZ $8, L
BGEZ $8, L
BLTZAL $8, L
BGEZAL $8, L`,
['1900FFFF', '1D00FFFE', '0500FFFD', '0501FFFC', '0510FFFB', '0511FFFA']);

expectHex('擬似命令（追加分）', `
L: B L
BEQZ $8, L
BNEZ $8, L
BLTU $1, $2, L
NOT $t0, $t1
NEG $t0, $t1
NEGU $t0, $t1
LI $a0, 'A'
LI $a0, ','
DIVU $t5, $t0, $t1`,
['1000FFFF', '1100FFFE', '1500FFFD', '0022082B', '1420FFFB', '01204027', '00094022', '00094023',
 '24040041', '2404002C', '0109001B', '00006812']);

expectHex('SYSCALL / BREAK', 'SYSCALL\nBREAK\nBREAK 5\nsyscall', ['0000000C', '0000000D', '0000014D', '0000000C']);
expectError('SYSCALL にオペランドはない', 'SYSCALL 1', /オペランドの数/);
expectError('BREAK のコード範囲', 'BREAK 0x100000', /BREAK のコード/);

expectHex('JAL', 'JAL F\nNOP\nF: JR $31', ['0C100002', '00000000', '03E00008']);

// --- 飛び先の指定方法 ---
expectHex('BEQ 絶対アドレス', 'BEQ $0,$0,0x00400010', ['10000003']);
expectHex('BNE 相対オフセット', 'BNE $1,$2,-2', ['1422FFFE']);
expectHex('J 絶対アドレス', 'J 0x00400020', ['08100008']);
expectHex('開始アドレス変更', 'L: J L', ['08000400'], 0x00001000);

// --- 擬似命令（MARS / SPIM と同じ展開） ---
expectHex('擬似命令', `
LI $t0, 10
LI $t1, 0x12345678
LA $t2, D
MOVE $t3, $t0
MUL $t4, $t0, $t1
DIV $t5, $t0, $t1
L: BLT $1, $2, L
BGE $1, $2, L
BGT $1, $2, L
BLE $1, $2, L
D: NOP`,
['2408000A', '3C011234', '34295678', '3C010040', '342A0048', '00085821',
 '01090018', '00006012', '0109001A', '00006812',
 '0022082A', '1420FFFE',
 '0022082A', '1020FFFC',
 '0041082A', '1420FFFA',
 '0041082A', '1020FFF8',
 '00000000']);

// --- データ（.data） ---
{
  const r = assemble(`
.data
A: .byte 1, 2
B: .word 0x11223344      # 4 バイト境界にそろう
C: .half -1
S: .asciiz "Hi\\n"
.align 2
D: .word B               # ラベルの番地
E: .space 8
F: .word 'Z'
.text
LA $t0, D
LW $t1, F`, {});
  const lab = Object.fromEntries(r.labels.map(l => [l.name, l.address]));
  check('データ: エラーなし', r.errors.length === 0 && r.warnings.length === 0, JSON.stringify(r.errors.concat(r.warnings)));
  check('データ: ラベルの番地', lab.A === 0x10010000 && lab.B === 0x10010004 && lab.C === 0x10010008 && lab.S === 0x1001000A &&
    lab.D === 0x10010010 && lab.E === 0x10010014 && lab.F === 0x1001001C, JSON.stringify(Object.fromEntries(Object.entries(lab).map(([k, v]) => [k, h0(v)]))));
  const dw = r.data.map(w => h0(w.address) + '=' + w.hex).join(' ');
  check('データ: 内容（ビッグエンディアン）', dw === '10010000=01020000 10010004=11223344 10010008=FFFF4869 1001000C=0A000000 10010010=10010004 1001001C=0000005A', dw);
  check('データ: LA と ラベルでの LW', r.words.map(w => w.hex).join(' ') === '3C011001 34280010 3C011001 8C29001C', r.words.map(w => w.hex).join(' '));
  check('データ: バイト数（境界合わせの隙間は含まない）', r.dataBytes === 28, String(r.dataBytes));
}
{
  // 行だけのラベルは、次のデータ（境界合わせの後）の番地になる
  const r = assemble('.data\n.byte 1\nARR:\n.word 5\n.text\nNOP', {});
  check('ラベルだけの行の後の .word', r.labels[0].address === 0x10010004, h0(r.labels[0].address));
  const s = assemble('.data\nS: .asciiz "a#b;c", "d"\n.text\nNOP', {});
  check('文字列の中の # ; はコメントではない・複数の文字列', s.data.map(w => w.hex).join(' ') === '6123623B 63006400', s.data.map(w => w.hex).join(' '));
  const u = assemble('.data\nS: .asciiz "あ"\n.text\nNOP', {});
  check('文字列は UTF-8', u.data.map(w => w.hex).join(' ') === 'E3818200', u.data.map(w => w.hex).join(' '));
  const a = assemble('.data 0x10008000\nX: .word 7\n.text\nLW $t0, X', {});
  check('.data のアドレス指定と %lo の符号拡張', a.words.map(w => w.hex).join(' ') === '3C011001 8C288000', a.words.map(w => w.hex).join(' '));
}
expectError('.word は .data の中で', '.word 1', /\.data の中で/);
expectError('命令は .text の中で', '.data\nADD $1,$2,$3', /命令は \.text/);
expectError('.byte の範囲', '.data\n.byte 256', /8 ビット/);
expectError('.half はラベル不可', '.data\n.half X', /数値ではありません/);
expectError('閉じていない文字列', '.data\n.asciiz "abc', /閉じられていません/);
expectError('未対応のエスケープ', '.data\n.asciiz "a\\q"', /エスケープ/);
expectError('.align の範囲', '.data\n.align 4', /\.align/);
expectError('メモリ指定にレジスタだけ', 'LW $8, $9', /メモリの指定/);

// --- エラー ---
expectError('未定義ラベル', 'J NOWHERE', /未定義のラベル/);
expectError('ラベル重複', 'A: NOP\nA: NOP', /重複/);
expectError('即値範囲外', 'ADDI $1,$0,70000', /16 ビット/);
expectError('レジスタ不正', 'ADD $32,$1,$2', /レジスタ/);
expectError('未知の命令', 'FOO $1', /未知の命令/);
expectError('オペランド数', 'ADD $1,$2', /オペランドの数/);
expectError('J 上位4bit', 'J 0x10000000', /上位 4 ビット/);
expectError('シフト量', 'SLL $1,$1,32', /シフト量/);

// エラー行があっても他の行は変換される
{
  const r = assemble('ADD $1,$2,$3\nFOO\nSUB $1,$2,$3', {});
  check('エラー行以外は変換', r.words.length === 2 && r.errors.length === 1 && r.errors[0].line === 2);
}

// ===== シミュレータ =====
const DATA = 0x10010000;
// opts: { regs, mem, delaySlot, loadUse }
function machine(src, mode, opts = {}) {
  const r = assemble(src, {});
  if (r.errors.length) throw new Error(JSON.stringify(r.errors));
  const initRegs = new Array(32).fill(0);
  Object.entries(opts.regs || {}).forEach(([k, v]) => { initRegs[k] = v; });
  const initMem = opts.mem ? Sim.parseMemInit(opts.mem).entries : [];
  return Sim.createMachine({ words: r.words, initRegs, initMem, mode, delaySlot: opts.delaySlot, loadUse: opts.loadUse });
}
function runToHalt(m, max = 2000) {
  for (let i = 0; i < max && !m.state.halted; i++) m.step();
  return m.state;
}
const h = v => (v >>> 0).toString(16).toUpperCase();
// 実行方式の組み合わせ
const CONFIGS = [
  ['seq', {}], ['seq', { delaySlot: true }],
  ['pipe', {}], ['pipe', { delaySlot: true }], ['pipe', { loadUse: 'delay' }], ['pipe', { delaySlot: true, loadUse: 'delay' }]
];
const cfgName = (mode, o) => mode + (o.delaySlot ? '+遅延分岐' : '') + (o.loadUse === 'delay' ? '+遅延ロード' : '');

check('既定の開始アドレスは 0x00400000', machine('NOP', 'seq').state.pc === 0x00400000);

const REGMEM = `ADDI $8,$0,0x7A
ADDI $9,$0,0x95
ADD $10,$8,$9
LUI $11,0x1001
SW $10,0($11)
LW $12,0($11)`;
for (const [mode, o] of CONFIGS) {
  const s = runToHalt(machine(REGMEM, mode, o));
  check(`レジスタとメモリ ${cfgName(mode, o)}: $10/$12/M[10010000]`,
    s.regs[10] === 0x10F && s.regs[12] === 0x10F && s.mem.get(DATA) === 0x10F && !s.haltError,
    `$10=${h(s.regs[10])} $12=${h(s.regs[12])} M=${h(s.mem.get(DATA) || 0)} ${s.haltReason}`);
}

const SUM = `       ADD $8,$0,$0
       LUI $9,0x1001
LOOP:  LW $10,0($9)
       BEQ $10,$0,HALT
       ADD $8,$8,$10
       ADDI $9,$9,4
       J LOOP
HALT:  J HALT`;
for (const mode of ['seq', 'pipe']) {
  // 遅延分岐なし・ストールありなら、NOP を入れなくてもパイプラインで正しく動く
  const s = runToHalt(machine(SUM, mode, { mem: '10010000: 1 2 4 3 0' }));
  check(`配列の総和 ${mode}`, s.regs[8] === 0xA && s.regs[9] === 0x10010010 && /自己ループ/.test(s.haltReason) && !s.haltError,
    `$8=${h(s.regs[8])} $9=${h(s.regs[9])} ${s.haltReason}`);
}

// 遅延分岐の有無
const BR = `BEQ $8,$9,L
ADDI $10,$10,1
L: ADDI $10,$10,1`;
for (const mode of ['seq', 'pipe']) {
  const fin = (o) => runToHalt(machine(BR, mode, o)).regs[10];
  check(`遅延分岐なし ${mode}: 成立は $10=1`, fin({}) === 1, `$10=${fin({})}`);
  check(`遅延分岐なし ${mode}: 不成立は $10=2`, fin({ regs: { 8: 1 } }) === 2);
  check(`遅延分岐あり ${mode}: 成立でも $10=2`, fin({ delaySlot: true }) === 2, `$10=${fin({ delaySlot: true })}`);
  check(`遅延分岐あり ${mode}: 不成立は $10=2`, fin({ delaySlot: true, regs: { 8: 1 } }) === 2);
}
for (const mode of ['seq', 'pipe']) {
  // JAL の戻り番地: 遅延分岐なし = PC+4、あり = PC+8
  const a = runToHalt(machine('JAL F\nNOP\nF: NOP', mode));
  const b = runToHalt(machine('JAL F\nNOP\nF: NOP', mode, { delaySlot: true }));
  check(`JAL の $ra ${mode}`, a.regs[31] === 0x00400004 && b.regs[31] === 0x00400008, `${h(a.regs[31])} / ${h(b.regs[31])}`);
}

{
  const m = machine(`ADD $10,$8,$9
ADD $13,$11,$12
ADD $14,$10,$13`, 'pipe', { regs: { 8: 9, 9: 0xA, 11: 0xB, 12: 0xC } });
  for (let i = 0; i < 4; i++) m.step();
  const s = m.state;
  check('クロック 4 のフォワーディング',
    s.pipe.id.rs === 0x13 && s.pipe.id.rt === 0x17 && s.fwd.rs === 'MEM' && s.fwd.rt === 'EX',
    `ID_RS=${h(s.pipe.id.rs)}(${s.fwd.rs}) ID_RT=${h(s.pipe.id.rt)}(${s.fwd.rt})`);
  const e = runToHalt(m);
  check('フォワーディングの結果 $14=0x2A', e.regs[14] === 0x2A && e.cycle === 7, `$14=${h(e.regs[14])} cycle=${e.cycle}`);
}

// ロード直後の依存（load-use ハザード）
{
  const opts = { regs: { 8: 1, 9: DATA, 10: 0x10 }, mem: '10010000: 5' };
  const d1 = runToHalt(machine('LW $8,0($9)\nADD $11,$10,$8', 'pipe', { ...opts, loadUse: 'delay' }));
  check('遅延ロード: NOP なしは古い $8 を使う', d1.regs[11] === 0x11 && d1.regs[8] === 5, `$11=${h(d1.regs[11])}`);
  const d2 = runToHalt(machine('LW $8,0($9)\nNOP\nADD $11,$10,$8', 'pipe', { ...opts, loadUse: 'delay' }));
  check('遅延ロード: NOP ありは正しい', d2.regs[11] === 0x15, `$11=${h(d2.regs[11])}`);

  const m = machine('LW $8,0($9)\nADD $11,$10,$8', 'pipe', opts);
  const s = runToHalt(m);
  const hist = m.history;
  const stalls = hist.filter(x => x.stall).length;
  const bubble = hist.some(x => x.pipe.id.bubble === 'stall');
  const info = hist.some(x => x.events.some(e => e.kind === 'info' && /ストール/.test(e.msg)));
  check('ストール: NOP なしでも正しい', s.regs[11] === 0x15 && stalls === 1 && bubble && info,
    `$11=${h(s.regs[11])} stalls=${stalls} bubble=${bubble} info=${info}`);
  check('ストール: 1 クロック余分にかかる', s.cycle === d1.cycle + 1, `${s.cycle} / ${d1.cycle}`);
  // 分岐が直前のロード結果を使う場合もストールする
  const b = runToHalt(machine('LW $8,0($9)\nBEQ $8,$0,L\nADDI $12,$0,1\nL: NOP', 'pipe', opts));
  check('ストール: 分岐の比較にロード結果を使う', b.regs[12] === 1, `$12=${b.regs[12]}`);
}

// 分岐成立時のフラッシュ（遅延分岐なしのパイプライン）
{
  const m = machine('BEQ $0,$0,L\nADDI $5,$0,1\nL: ADDI $6,$0,2', 'pipe');
  const s = runToHalt(m);
  const flushed = m.history.some(x => x.pipe.if.bubble === 'flush' && x.pipe.if.pc === 0x00400004);
  check('フラッシュ: 分岐直後の命令は実行しない', s.regs[5] === 0 && s.regs[6] === 2 && flushed, `$5=${s.regs[5]} $6=${s.regs[6]} flushed=${flushed}`);
  check('フラッシュした命令は完了数に数えない', s.count === 2, `count=${s.count}`);
}

for (const [mode, o] of CONFIGS) {
  const s = runToHalt(machine(`LI $t0, -3
LI $t1, 7
MULT $t0, $t1
MFLO $s0
MFHI $s1
DIV $t1, $t0
MFLO $s2
MFHI $s3
LUI $t2, 0x1001
LI $t3, 0x80
SB $t3, 1($t2)
NOP
LB $s4, 1($t2)
LBU $s5, 1($t2)
LW $s6, 0($t2)
JAL F
NOP
J END
NOP
F: ADDI $s7, $0, 9
JR $ra
NOP
END: NOP`, mode, o));
  check(`算術・メモリ・関数呼出し ${cfgName(mode, o)}`,
    s.regs[16] === 0xFFFFFFEB && s.regs[17] === 0xFFFFFFFF && s.regs[18] === 0xFFFFFFFE && s.regs[19] === 1 &&
    s.regs[20] === 0xFFFFFF80 && s.regs[21] === 0x80 && s.regs[22] === 0x00800000 && s.regs[23] === 9 && !s.haltError,
    [16, 17, 18, 19, 20, 21, 22, 23].map(i => `$${i}=${h(s.regs[i])}`).join(' ') + ' ' + s.haltReason);
}

// ===== 追加した命令の実行 =====
for (const [mode, o] of CONFIGS) {
  const s = runToHalt(machine(`LI $t0, -16
SRA $s0, $t0, 2
LI $t1, 3
SRAV $s1, $t0, $t1
SRLV $s2, $t0, $t1
SLLV $s3, $t1, $t1
NOR $s4, $t0, $0
SLTU $s5, $t1, $t0
SLTIU $s6, $t1, -1
LI $t2, -1
MULTU $t2, $t2
MFHI $s7
MFLO $t3
DIVU $t2, $t1
MFLO $t4
MFHI $t5
LUI $t6, 0x1001
LI $t7, 0x8001
SH $t7, 2($t6)
NOP
LH $t8, 2($t6)
LHU $t9, 2($t6)
LW $v1, 0($t6)`, mode, o));
  const want = { 16: 0xFFFFFFFC, 17: 0xFFFFFFFE, 18: 0x1FFFFFFE, 19: 24, 20: 15, 21: 1, 22: 1, 23: 0xFFFFFFFE,
    11: 1, 12: 0x55555555, 13: 0, 24: 0xFFFF8001, 25: 0x8001, 3: 0x8001 };
  const bad = Object.keys(want).filter(k => s.regs[k] !== want[k]);
  check(`シフト・符号なし演算・ハーフワード ${cfgName(mode, o)}`, bad.length === 0 && !s.haltError,
    bad.map(k => `$${k}=${h(s.regs[k])}（期待 ${h(want[k])}）`).join(' ') + ' ' + s.haltReason);

  const b = runToHalt(machine(`LI $a0, -1
BLTZ $a0, L1
NOP
LI $a1, 99
L1: BGEZ $a0, L2
NOP
LI $a2, 7
L2: BLEZ $zero, L3
NOP
LI $a3, 99
L3: BGTZ $zero, END
NOP
LA $t0, F
JALR $t0
NOP
BGEZAL $zero, G
NOP
J END
NOP
F: LI $v0, 5
JR $ra
NOP
G: ADDIU $fp, $fp, 1
JR $ra
NOP
END: NOP`, mode, o));
  check(`0 と比較する分岐・JALR・BGEZAL ${cfgName(mode, o)}`,
    b.regs[5] === 0 && b.regs[6] === 7 && b.regs[7] === 0 && b.regs[2] === 5 && b.regs[30] === 1 && !b.haltError,
    [2, 5, 6, 7, 30].map(k => `$${k}=${b.regs[k]}`).join(' ') + ' ' + b.haltReason);
}
for (const mode of ['seq', 'pipe']) {
  // BLTZAL は分岐しなくても $ra を書く
  const a = runToHalt(machine('LI $t0, 1\nBLTZAL $t0, X\nNOP\nX: NOP', mode));
  const b = runToHalt(machine('LI $t0, 1\nBLTZAL $t0, X\nNOP\nX: NOP', mode, { delaySlot: true }));
  check(`BLTZAL 不成立でも $ra ${mode}`, a.regs[31] === 0x00400008 && b.regs[31] === 0x0040000C, `${h(a.regs[31])} / ${h(b.regs[31])}`);
  const u = runToHalt(machine('LUI $9,0x1001\nNOP\nNOP\nLH $8,1($9)', mode));
  check(`2 の倍数でない LH はエラー停止 ${mode}`, u.haltError && /2 の倍数/.test(u.haltReason), u.haltReason);
  const z = runToHalt(machine('DIVU $8,$9', mode));
  check(`DIVU の 0 除算 ${mode}`, z.haltError && /DIVU/.test(z.haltReason), z.haltReason);
}

// ===== .data を使うプログラム =====
function machineData(src, mode, opts = {}) {
  const r = assemble(src, {});
  if (r.errors.length) throw new Error(JSON.stringify(r.errors));
  const initMem = r.data.map(w => ({ address: w.address, value: w.value }));
  return Sim.createMachine({ words: r.words, initRegs: new Array(32).fill(0), initMem, mode, delaySlot: opts.delaySlot, loadUse: opts.loadUse });
}
for (const [mode, o] of CONFIGS) {
  const s = runToHalt(machineData(`.data
ARR:  .word 10, 20, 30
MSG:  .asciiz "合計="
.text
LI $t1, 8
LW $t0, ARR($t1)
LW $t2, ARR+4
NOP
ADDU $t3, $t0, $t2
SW $t3, ARR
LA $a0, MSG
LI $v0, 4
SYSCALL
LW $a0, ARR
LI $v0, 1
SYSCALL
LI $v0, 10
SYSCALL`, mode, o));
  check(`.data とラベルでのメモリアクセス ${cfgName(mode, o)}`,
    s.regs[8] === 30 && s.regs[10] === 20 && s.mem.get(0x10010000) === 50 && s.output === '合計=50' && !s.haltError,
    `$8=${s.regs[8]} $10=${s.regs[10]} out=${JSON.stringify(s.output)} ${s.haltReason}`);
}

// ===== 実行途中の書き換え =====
{
  const m = machine('ADDIU $t0, $t0, 1\nADDIU $t0, $t0, 1', 'seq');
  m.step();
  m.edit({ reg: 8 }, 100);
  m.edit({ mem: 0x10010000 }, 7);
  const e = m.state;
  check('書き換えはクロックを進めない', e.cycle === 1 && e.edited && e.regs[8] === 100 && e.mem.get(0x10010000) === 7);
  m.step();
  check('書き換えた値で続きを実行', m.state.regs[8] === 101 && !m.state.edited);
  m.back(); m.back();
  check('◀ でメモリの書き換えを取り消せる', m.state.regs[8] === 100 && !m.state.mem.has(0x10010000) && m.state.cycle === 1);
  m.back();
  check('◀ でレジスタの書き換えも取り消せる', m.state.regs[8] === 1 && m.state.cycle === 1);
  m.edit({ reg: 0 }, 5);
  check('$0 は書き換えない', m.state.regs[0] === 0);
}

// ===== パイプライン図のための通し番号 =====
{
  const m = machine('LI $t0, 1\nB L\nADDIU $t1, $0, 1\nL: ADDIU $t2, $0, 2', 'pipe');
  runToHalt(m);
  const seqs = m.history.map(s => s.pipe.if.seq);
  const flushed = m.history.find(s => s.pipe.if.bubble === 'flush');
  check('フェッチごとに通し番号が増える', seqs[1] === 1 && seqs[2] === 2 && seqs[3] === 3, seqs.join(','));
  check('フラッシュした命令にも番号がある', flushed && flushed.pipe.if.seq > 0);
  const s3 = m.history[3];
  check('番号は後ろのステージへ受け渡す', m.history[4].pipe.id.seq === s3.pipe.if.seq || m.history[4].pipe.id.bubble !== '');
}

// ===== 算術オーバーフロー例外 =====
for (const mode of ['seq', 'pipe']) {
  const ovf = (src) => runToHalt(machine(src, mode));
  const a = ovf('LI $t0, 0x7FFFFFFF\nADDI $t1, $t0, 1');
  check(`ADDI オーバーフロー ${mode}`, a.haltError && /オーバーフロー/.test(a.haltReason) && a.regs[9] === 0, a.haltReason);
  const b = ovf('LI $t0, 0x7FFFFFFF\nADDIU $t1, $t0, 1');
  check(`ADDIU は例外なし ${mode}`, !b.haltError && b.regs[9] === 0x80000000, b.haltReason);
  const c = ovf('LUI $8,0x8000\nADD $9,$8,$8');
  check(`ADD オーバーフロー ${mode}`, c.haltError && /オーバーフロー例外（ADD）/.test(c.haltReason) && c.regs[9] === 0, c.haltReason);
  const d = ovf('LUI $8,0x8000\nADDU $9,$8,$8');
  check(`ADDU は例外なし ${mode}`, !d.haltError && d.regs[9] === 0, d.haltReason);
  const e = ovf('LUI $8,0x8000\nSUB $10,$0,$8');
  check(`SUB 0 − (−2^31) はオーバーフロー ${mode}`, e.haltError && /オーバーフロー例外（SUB）/.test(e.haltReason), e.haltReason);
  const f = ovf('LUI $8,0x8000\nADDIU $9,$0,-1\nSUB $10,$9,$8');
  check(`SUB −1 − (−2^31) は収まる ${mode}`, !f.haltError && f.regs[10] === 0x7FFFFFFF, f.haltReason);
  const g = ovf('LUI $8,0x8000\nADDIU $9,$0,1\nSUB $10,$8,$9');
  check(`SUB −2^31 − 1 はオーバーフロー ${mode}`, g.haltError, g.haltReason);
  const k = ovf('LUI $8,0x8000\nSUBU $10,$0,$8');
  check(`SUBU は例外なし ${mode}`, !k.haltError && k.regs[10] === 0x80000000, k.haltReason);
}
{
  // パイプライン: 先行する命令は完了し、後続の命令は実行されない
  const s = runToHalt(machine('ADDIU $5,$0,3\nLUI $8,0x8000\nADD $9,$8,$8\nADDIU $6,$0,4', 'pipe'));
  check('パイプラインの例外: 先行は完了・後続は破棄',
    s.haltError && s.regs[5] === 3 && s.regs[8] === 0x80000000 && s.regs[9] === 0 && s.regs[6] === 0,
    `$5=${s.regs[5]} $8=${h(s.regs[8])} $9=${s.regs[9]} $6=${s.regs[6]} ${s.haltReason}`);
}

// ===== SYSCALL / BREAK =====
for (const [mode, o] of CONFIGS) {
  const s = runToHalt(machine(`LI $a0, -42
LI $v0, 1
SYSCALL
LI $a0, 0x41
LI $v0, 11
SYSCALL
LI $a0, 255
LI $v0, 34
SYSCALL
LI $v0, 10
SYSCALL
ADDIU $5, $0, 1`, mode, o));
  check(`SYSCALL 出力と終了 ${cfgName(mode, o)}`,
    s.output === '-42A0x000000ff' && s.halted && !s.haltError && /SYSCALL 10/.test(s.haltReason) && s.regs[5] === 0,
    JSON.stringify(s.output) + ' ' + s.haltReason + ` $5=${s.regs[5]}`);
}
for (const mode of ['seq', 'pipe']) {
  const str = runToHalt(machine('LUI $a0,0x1001\nLI $v0,4\nSYSCALL\nLI $v0,10\nSYSCALL', mode, { mem: '10010000: 48656C6C 6F0A0000' }));
  check(`SYSCALL 4 文字列 ${mode}`, str.output === 'Hello\n', JSON.stringify(str.output));
  const ex = runToHalt(machine('LI $a0, 3\nLI $v0, 17\nSYSCALL', mode));
  check(`SYSCALL 17 終了コード ${mode}`, !ex.haltError && /終了コード 3/.test(ex.haltReason), ex.haltReason);
  const un = runToHalt(machine('LI $v0, 5\nSYSCALL', mode));
  check(`未対応の SYSCALL はエラー ${mode}`, un.haltError && /対応していません/.test(un.haltReason), un.haltReason);
  const br = runToHalt(machine('ADDIU $5,$0,1\nBREAK\nADDIU $6,$0,1', mode));
  check(`BREAK で停止 ${mode}`, br.halted && !br.haltError && /BREAK/.test(br.haltReason) && br.regs[5] === 1 && br.regs[6] === 0,
    `${br.haltReason} $5=${br.regs[5]} $6=${br.regs[6]}`);
}
{
  // SYSCALL も $a0 / $v0 をフォワーディング・ストールで受け取る
  const opts = { mem: '10010000: 7' };
  const st = runToHalt(machine('LUI $t0,0x1001\nLI $v0,1\nLW $a0,0($t0)\nSYSCALL', 'pipe', opts));
  check('SYSCALL がロード直後の $a0 をストールで受け取る', st.output === '7', JSON.stringify(st.output));
  const dl = runToHalt(machine('LUI $t0,0x1001\nLI $v0,1\nLW $a0,0($t0)\nSYSCALL', 'pipe', { ...opts, loadUse: 'delay' }));
  check('遅延ロードでは SYSCALL は古い $a0 を使う', dl.output === '0', JSON.stringify(dl.output));
}

{
  const m = machine(REGMEM, 'pipe');
  for (let i = 0; i < 5; i++) m.step();
  const snap = JSON.stringify([m.state.regs, m.state.cycle, m.state.pipe.ex.c]);
  m.step(); m.step(); m.back(); m.back();
  check('1つ戻る', JSON.stringify([m.state.regs, m.state.cycle, m.state.pipe.ex.c]) === snap);
}

{
  const p = Sim.parseMemInit('10010000: 1 2 0xFF\nzzz');
  check('メモリ初期値の解析', p.entries.length === 3 && p.entries[2].address === 0x10010008 && p.entries[2].value === 0xFF && p.errors.length === 1);
}

// ===== パイプラインの各クロックの値 =====
// 観測表の値: hist[0] = 初期値、hist[k] = k クロック後
function trace(src, opts) {
  const m = machine(src, 'pipe', opts);
  runToHalt(m);
  return m.history;
}
const P = s => ({ PC: s.pc, IF_PC: s.pipe.if.pc, ID_PC: s.pipe.id.pc, EX_PC: s.pipe.ex.pc, MEM_PC: s.pipe.mem.pc,
  ID_RS: s.pipe.id.rs, ID_RT: s.pipe.id.rt, EX_C: s.pipe.ex.c, MEM_C: s.pipe.mem.c, SMD: s.pipe.ex.smd });
function expectRow(name, hist, k, want) {
  const got = Object.assign(P(hist[k]), { regs: hist[k].regs, mem: hist[k].mem });
  const bad = Object.keys(want).filter(key => {
    if (key.startsWith('$')) return got.regs[+key.slice(1)] !== want[key];
    if (key.startsWith('m')) return (got.mem.get(parseInt(key.slice(1), 16)) || 0) !== want[key];
    return got[key] !== want[key];
  });
  check(`${name} ${k}クロック`, bad.length === 0,
    bad.map(b => `${b}: ${h(b.startsWith('$') ? got.regs[+b.slice(1)] : b.startsWith('m') ? got.mem.get(parseInt(b.slice(1), 16)) || 0 : got[b])} (期待 ${h(want[b])})`).join(', '));
}
const NOPS = n => '\nNOP'.repeat(n);

// ADD: 各ステージでの受け渡し
{
  const hs = trace('ADD $10, $8, $9' + NOPS(5), { regs: { 8: 3, 9: 4 } });
  expectRow('ADD', hs, 0, { PC: 0x00400000, IF_PC: 0, ID_PC: 0, EX_C: 0, MEM_C: 0, $10: 0 });
  expectRow('ADD', hs, 1, { PC: 0x00400004, IF_PC: 0x00400000 });
  expectRow('ADD', hs, 2, { ID_PC: 0x00400000, ID_RS: 3, ID_RT: 4 });
  expectRow('ADD', hs, 3, { EX_PC: 0x00400000, EX_C: 7, $10: 0 });
  expectRow('ADD', hs, 4, { MEM_PC: 0x00400000, MEM_C: 7, $10: 0 });
  expectRow('ADD', hs, 5, { $10: 7 });
}
// LW: MEM ステージでメモリを読み、mem_C へ
{
  const hs = trace('LW $9, 8($8)' + NOPS(5), { regs: { 8: DATA }, mem: '10010008: 1234' });
  expectRow('LW', hs, 3, { EX_C: 0x10010008 });
  expectRow('LW', hs, 4, { MEM_C: 0x1234, $9: 0 });
  expectRow('LW', hs, 5, { $9: 0x1234 });
}
// SW: EX で SMD に設定、MEM でメモリへ書き込み
{
  const hs = trace('SW $9, 8($8)' + NOPS(5), { regs: { 8: DATA, 9: 0x55 } });
  expectRow('SW', hs, 3, { EX_C: 0x10010008, SMD: 0x55, m10010008: 0 });
  expectRow('SW', hs, 4, { m10010008: 0x55 });
}
// BEQ: ID で分岐先が決まる（遅延分岐なしなら、直後にフェッチした命令はフラッシュ）
for (const delaySlot of [false, true]) {
  const name = 'BEQ' + (delaySlot ? '（遅延分岐）' : '');
  const src = 'BEQ $8, $9, L' + NOPS(2) + '\nL: NOP' + NOPS(2);
  const taken = trace(src, { regs: { 8: 5, 9: 5 }, delaySlot });
  expectRow(name + ' 成立', taken, 2, { PC: 0x0040000C, IF_PC: 0x00400004 });
  expectRow(name + ' 成立', taken, 3, { IF_PC: 0x0040000C });
  check(name + ' 成立: 直後の命令は' + (delaySlot ? '遅延スロット' : 'フラッシュ'),
    delaySlot ? taken[2].pipe.if.slot && !taken[2].pipe.if.bubble : taken[2].pipe.if.bubble === 'flush');
  const nt = trace(src, { regs: { 8: 5, 9: 6 }, delaySlot });
  expectRow(name + ' 不成立', nt, 2, { PC: 0x00400008 });
  expectRow(name + ' 不成立', nt, 3, { IF_PC: 0x00400008 });
}
// 依存のない複数命令
{
  const hs = trace('ADD $10, $8, $9\nADD $13, $11, $12\nADD $16, $14, $15' + NOPS(5),
    { regs: { 8: 1, 9: 2, 11: 5, 12: 6, 14: 7, 15: 8 } });
  expectRow('依存なし', hs, 5, { $10: 3, $13: 0 });
  expectRow('依存なし', hs, 7, { $10: 3, $13: 11, $16: 15 });
}
// フォワーディング（EX→ID と MEM→ID）
{
  const hs = trace('ADD $10, $8, $9\nADD $13, $11, $12\nADD $14, $10, $13' + NOPS(5),
    { regs: { 8: 9, 9: 0xA, 11: 0xB, 12: 0xC } });
  expectRow('フォワーディング', hs, 4, { ID_PC: 0x00400008, ID_RS: 0x13, ID_RT: 0x17 });
  expectRow('フォワーディング', hs, 7, { $14: 0x2A });
}
// ロード直後の依存: 遅延ロードは間に合わない／NOP を挟むと MEM→ID で受け取る／ストールなら NOP 不要
{
  const opts = { regs: { 8: 1, 9: DATA, 10: 0x10 }, mem: '10010000: 5' };
  const bad = trace('LW $8, 0($9)\nADD $11, $10, $8' + NOPS(5), { ...opts, loadUse: 'delay' });
  check('遅延ロード NOPなしは正しくない', bad[bad.length - 1].regs[11] !== 0x15, `$11=${h(bad[bad.length - 1].regs[11])}`);
  const ok = trace('LW $8, 0($9)\nNOP\nADD $11, $10, $8' + NOPS(5), { ...opts, loadUse: 'delay' });
  expectRow('遅延ロード NOPあり', ok, 4, { ID_PC: 0x00400008, ID_RT: 5 });
  check('遅延ロード NOPありは $11=15', ok[ok.length - 1].regs[11] === 0x15, `$11=${h(ok[ok.length - 1].regs[11])}`);
  const st = trace('LW $8, 0($9)\nADD $11, $10, $8' + NOPS(5), opts);
  // クロック 3: LW が EX、ADD は IF/ID に留まり、ID/EX にバブル
  expectRow('ストール', st, 3, { PC: 0x00400008, IF_PC: 0x00400004, EX_PC: 0x00400000 });
  check('ストール 3クロック: ID/EX はバブル', st[3].pipe.id.bubble === 'stall' && st[3].stall);
  expectRow('ストール', st, 4, { ID_PC: 0x00400004, ID_RT: 5 });
  check('ストールは $11=15', st[st.length - 1].regs[11] === 0x15);
}
// 総和プログラム: 遅延分岐・遅延ロードでも、NOP を入れれば正しく動く
{
  const src = `ADD $8,$0,$0
LUI $9,0x1001
LOOP: LW $10,0($9)
NOP
BEQ $10,$0,HALT
NOP
ADD $8,$8,$10
ADDI $9,$9,4
J LOOP
NOP
HALT: J HALT
NOP`;
  const s = runToHalt(machine(src, 'pipe', { mem: '10010000: 1 2 4 3 0', delaySlot: true, loadUse: 'delay' }));
  check('NOP 挿入後の総和（遅延分岐・遅延ロード）', s.regs[8] === 0xA && !s.haltError, `$8=${h(s.regs[8])} ${s.haltReason}`);
}
// 乗除算（$10 = $8*$9, $12 = $10/$11 の商, $13 = 余り）
{
  const s = runToHalt(machine('MULT $8, $9\nMFLO $10\nDIV $10, $11\nMFLO $12\nMFHI $13', 'seq', { regs: { 8: 12, 9: 13, 11: 7 } }));
  check('乗除算', s.regs[10] === 156 && s.regs[12] === 22 && s.regs[13] === 2, `$10=${s.regs[10]} $12=${s.regs[12]} $13=${s.regs[13]}`);
}

// ===== 境界値・書式のテスト =====
const words = src => { const r = assemble(src, {}); return r.errors.length ? 'ERR:' + r.errors[0].message : r.words.map(w => w.hex).join(' '); };
const errOf = src => { const r = assemble(src, {}); return r.errors.length ? r.errors[0].message : ''; };
// コメント・改行コード・大文字小文字・空白
check('コメント # // ;', words('ADD $1,$2,$3 # a\nSUB $1,$2,$3 // b\nAND $1,$2,$3 ; c') === '00430820 00430822 00430824');
check('CRLF の改行', words('ADD $1,$2,$3\r\nJ L\r\nL: NOP\r\n') === '00430820 08100002 00000000');
check('小文字・大文字の混在', words('add $T0, $ZERO, $s8') === '001E4020');
check('ラベルだけの行と複数ラベル', words('A:\nB: C: NOP\nJ A\nJ C') === '00000000 08100000 08100000');
check('メモリ指定の空白と offset 省略', words('LW $8, 4 ( $9 )\nLW $8,($9)') === '8D280004 8D280000');
check('空のプログラム', words('\n\n# だけ\n') === '');
check('末尾のカンマはエラー', /空のオペランド/.test(errOf('ADD $1,$2,')));
check('.text / .globl は使える・未知のディレクティブは警告', (() => { const r = assemble('.text\n.globl main\n.foo\nNOP', {}); return r.errors.length === 0 && r.warnings.length === 1 && r.words.length === 1; })());
// 即値・シフト量・分岐距離の範囲
check('ADDI 即値の上限下限', words('ADDI $1,$0,32767\nADDI $1,$0,-32768\nADDI $1,$0,0xFFFF') === '20017FFF 20018000 2001FFFF');
check('ADDI 65536 はエラー', /16 ビット/.test(errOf('ADDI $1,$0,65536')));
check('ADDI -32769 はエラー', /16 ビット/.test(errOf('ADDI $1,$0,-32769')));
check('シフト量 31 は可・32 と -1 はエラー', words('SLL $1,$1,31') === '00010FC0' && /シフト量/.test(errOf('SLL $1,$1,32')) && /シフト量/.test(errOf('SLL $1,$1,-1')));
check('分岐オフセット +32767 は可・+32768 はエラー', words('BEQ $0,$0,+32767') === '10007FFF' && /範囲外/.test(errOf('BEQ $0,$0,+32768')));
check('分岐先が 4 の倍数でないとエラー', /4 の倍数/.test(errOf('BEQ $0,$0,0x00400006')));
check('J で上位 4 ビットをまたぐとエラー', /上位 4 ビット/.test(errOf('J 0x90000000')));
check('未定義ラベルの大文字小文字ヒント', /"Loop" のことですか/.test(errOf('Loop: NOP\nJ LOOP')));
check('レジスタ $32 と未知の名前はエラー', /レジスタ/.test(errOf('ADD $32,$1,$1')) && /レジスタ/.test(errOf('ADD $x9,$1,$1')));
// LI の展開: 符号付き 16 ビット → ADDIU、符号なし 16 ビット → ORI、それ以外 → LUI + ORI
check('LI 32767 / -32768 は ADDIU', words('LI $8,32767\nLI $8,-32768') === '24087FFF 24088000');
check('LI 32768 / 0xFFFF は ORI', words('LI $8,32768\nLI $8,0xFFFF') === '34088000 3408FFFF');
check('LI 65536 は 2 語', words('LI $8,65536') === '3C010001 34280000');
check('LI -32769 は 2 語', words('LI $8,-32769') === '3C01FFFF 34287FFF');
check('LI 0xFFFFFFFF は 2 語', words('LI $8,0xFFFFFFFF') === '3C01FFFF 3428FFFF');
check('LI 2^32 はエラー', /32 ビット/.test(errOf('LI $8,4294967296')));
check('MOVE は ADDU', words('MOVE $t3, $t0') === '00085821');
check('DIV 2 オペランドは実命令・3 オペランドは擬似命令', words('DIV $8,$9') === '0109001A' && words('DIV $10,$8,$9') === '0109001A 00005012');
check('LB の opcode は 0x20（J と重ならない）', Sim.decode(0x83A8FFFC).mn === 'LB' && Sim.decode(0x08100000).mn === 'J');
// シミュレータの境界
for (const mode of ['seq', 'pipe']) {
  const s = runToHalt(machine('ADDI $0,$0,5\nADD $1,$0,$0\nADDI $2,$0,7', mode));
  check(`$0 への書き込みは無視 ${mode}`, s.regs[0] === 0 && s.regs[1] === 0 && s.regs[2] === 7);
  const u = runToHalt(machine('LUI $9,0x1001\nNOP\nNOP\nLW $8,2($9)', mode));
  check(`4 の倍数でない LW はエラー停止 ${mode}`, u.haltError && /4 の倍数/.test(u.haltReason), u.haltReason);
  const z = runToHalt(machine('DIV $8,$9', mode));
  check(`0 除算はエラー停止 ${mode}`, z.haltError && /0 で除算/.test(z.haltReason), z.haltReason);
  const lp = runToHalt(machine('ADDI $5,$0,1\nHALT: J HALT\nADDI $6,$0,1', mode, { delaySlot: true }));
  check(`遅延分岐の自己ループは遅延スロットを実行して停止 ${mode}`, /自己ループ/.test(lp.haltReason) && lp.regs[5] === 1 && lp.regs[6] === 1,
    `${lp.haltReason} $6=${lp.regs[6]}`);
  const ln = runToHalt(machine('ADDI $5,$0,1\nHALT: J HALT\nADDI $6,$0,1', mode));
  check(`遅延分岐なしの自己ループ ${mode}`, /自己ループ/.test(ln.haltReason) && ln.regs[5] === 1 && ln.regs[6] === 0,
    `${ln.haltReason} $6=${ln.regs[6]}`);
}
{
  // パイプライン: 直前の ORI の結果で JR（ALU からのフォワーディングで飛び先を決める）
  const s = runToHalt(machine('LUI $31,0x0040\nORI $31,$31,0x14\nJR $31\nNOP\nADDI $5,$0,1\nADDI $6,$0,2', 'pipe'));
  check('パイプライン JR へのフォワーディング', s.regs[5] === 0 && s.regs[6] === 2, `$5=${s.regs[5]} $6=${s.regs[6]}`);
}
{
  // 履歴の上限（5000）を超えて実行しても壊れず、戻れる
  const m = machine('L: ADDI $8,$8,1\nJ L', 'seq');
  for (let i = 0; i < 6000; i++) m.step();
  const hist = m.history, prev = hist[hist.length - 2];
  m.back();
  check('履歴上限を超えても戻れる', hist.length === 5001 && m.state === prev && m.state.cycle === 5999, `len=${hist.length} cycle=${m.state.cycle}`);
  m.reset();
  check('リセットで初期状態に戻る', m.state.cycle === 0 && m.state.regs[8] === 0 && m.history.length === 1);
}

// ===== ランダムテスト =====
// 再現性のある乱数（シード固定）
// mulberry32（線形合同法の下位ビットは周期が短く、2 択が偏るため使わない）
let seed = +(process.env.SEED || 12345);   // SEED=… で乱数の種を変えられる
const rnd = n => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) % n;
};
const pick = arr => arr[rnd(arr.length)];

// --- 1. 機械語の往復: アセンブル → デコード → 逆アセンブル → 再アセンブルで同じ語になる ---
{
  const R3 = ['ADD', 'ADDU', 'SUB', 'SUBU', 'AND', 'OR', 'XOR', 'NOR', 'SLT', 'SLTU'], SH = ['SLL', 'SRL', 'SRA'];
  const IA = ['ADDI', 'ADDIU', 'ANDI', 'ORI', 'XORI', 'SLTI', 'SLTIU'];
  const MEMI = ['LW', 'LB', 'LBU', 'LH', 'LHU', 'SW', 'SH', 'SB'], MD = ['MULT', 'MULTU', 'DIV', 'DIVU'];
  const MF = ['MFHI', 'MFLO'], MT = ['MTHI', 'MTLO'];
  const BZ = ['BLEZ', 'BGTZ', 'BLTZ', 'BGEZ', 'BLTZAL', 'BGEZAL'], SV = ['SLLV', 'SRLV', 'SRAV'];
  const r = () => '$' + rnd(32);
  const imm = () => String(rnd(65536) - 32768);
  const gen = () => {
    switch (rnd(15)) {
      case 0: { const m = pick(R3); return `${m} ${r()}, ${r()}, ${r()}`; }
      case 1: { const m = pick(SH); return `${m} ${r()}, ${r()}, ${rnd(32)}`; }
      case 2: { const m = pick(IA); return `${m} ${r()}, ${r()}, ${imm()}`; }
      case 3: return `LUI ${r()}, ${rnd(65536)}`;
      case 4: { const m = pick(MEMI); return `${m} ${r()}, ${imm()}(${r()})`; }
      case 5: return `${pick(['BEQ', 'BNE'])} ${r()}, ${r()}, ${rnd(2) ? '+' : '-'}${rnd(32768)}`;
      case 6: return `${pick(['J', 'JAL'])} 0x${(0x00400000 + rnd(0x100000) * 4).toString(16)}`;
      case 7: return `JR ${r()}`;
      case 8: { const m = pick(MD); return `${m} ${r()}, ${r()}`; }
      case 9: return `${pick(MF)} ${r()}`;
      case 10: return rnd(2) ? 'SYSCALL' : `BREAK ${rnd(0x100000)}`;
      case 11: return `${pick(BZ)} ${r()}, ${rnd(2) ? '+' : '-'}${rnd(32768)}`;
      case 12: return `${pick(SV)} ${r()}, ${r()}, ${r()}`;
      case 13: return rnd(2) ? `JALR ${r()}` : `JALR ${r()}, ${r()}`;
      default: return `${pick(MT)} ${r()}`;
    }
  };
  let bad = 0, first = '';
  for (let i = 0; i < 3000; i++) {
    const text = gen();
    const pc = 0x00400000 + rnd(0x100000) * 4;
    const a = assemble(text, { startAddress: pc });
    if (a.errors.length || a.words.length !== 1) { bad++; first = first || `${text}: ${JSON.stringify(a.errors)}`; continue; }
    const w = a.words[0];
    const d = Sim.decode(w.word);
    const back = Sim.disasm(d, pc);
    const b = assemble(back, { startAddress: pc });
    if (b.errors.length || b.words[0].word !== w.word) { bad++; first = first || `${text} → ${back} → ${JSON.stringify(b.errors)} ${b.words[0] && b.words[0].hex} (元 ${w.hex})`; }
  }
  check('往復テスト 3000 命令', bad === 0, `${bad} 件不一致。例: ${first}`);
}

// --- 2. 独立した参照実装との比較（逐次モード） ---
// 参照実装: シミュレータとは別に、MIPS の意味を素直に書いたもの
// ADD / SUB / ADDI のオーバーフローでは、その命令を実行せずに止まる（trap: true）
function refRun(lines, regs0, mem0) {
  const R = regs0.map(v => v >>> 0), M = new Map(mem0);
  let hi = 0, lo = 0, trap = false;
  const s = v => v | 0, u = v => v >>> 0;
  const set = (n, v) => { if (n) R[n] = u(v); };
  const rd = a => M.get(u(a & ~3)) || 0;
  const fits = v => v >= -0x80000000 && v <= 0x7FFFFFFF;
  let i = 0, guard = 0;
  while (i < lines.length && guard++ < 10000) {
    const L = lines[i];
    const [op, x, y, z] = L;
    let next = i + 1;
    switch (op) {
      case 'ADD': if (!fits(s(R[y]) + s(R[z]))) { trap = true; break; } set(x, R[y] + R[z]); break;
      case 'SUB': if (!fits(s(R[y]) - s(R[z]))) { trap = true; break; } set(x, R[y] - R[z]); break;
      case 'ADDI': if (!fits(s(R[y]) + z)) { trap = true; break; } set(x, R[y] + z); break;
      case 'ADDU': set(x, R[y] + R[z]); break;
      case 'SUBU': set(x, R[y] - R[z]); break;
      case 'ADDIU': set(x, R[y] + z); break;
      case 'AND': set(x, R[y] & R[z]); break;
      case 'OR': set(x, R[y] | R[z]); break;
      case 'XOR': set(x, R[y] ^ R[z]); break;
      case 'SLT': set(x, s(R[y]) < s(R[z]) ? 1 : 0); break;
      case 'NOR': set(x, ~(R[y] | R[z])); break;
      case 'SLTU': set(x, R[y] < R[z] ? 1 : 0); break;
      case 'SLL': set(x, R[y] << z); break;
      case 'SRL': set(x, R[y] >>> z); break;
      case 'SRA': set(x, s(R[y]) >> z); break;
      case 'SLLV': set(x, R[y] << (R[z] & 31)); break;
      case 'SRLV': set(x, R[y] >>> (R[z] & 31)); break;
      case 'SRAV': set(x, s(R[y]) >> (R[z] & 31)); break;
      case 'SLTIU': set(x, R[y] < u(z) ? 1 : 0); break;
      case 'SLTI': set(x, s(R[y]) < z ? 1 : 0); break;
      case 'ANDI': set(x, R[y] & (z & 0xFFFF)); break;
      case 'ORI': set(x, R[y] | (z & 0xFFFF)); break;
      case 'XORI': set(x, R[y] ^ (z & 0xFFFF)); break;
      case 'LUI': set(x, (y & 0xFFFF) * 65536); break;
      case 'MULT': { const p = BigInt(s(R[x])) * BigInt(s(R[y])); hi = Number(BigInt.asUintN(32, p >> 32n)); lo = Number(BigInt.asUintN(32, p)); break; }
      case 'DIV': { const q = BigInt(s(R[x])) / BigInt(s(R[y])); const m = BigInt(s(R[x])) % BigInt(s(R[y])); lo = Number(BigInt.asUintN(32, q)); hi = Number(BigInt.asUintN(32, m)); break; }
      case 'MULTU': { const p = BigInt(R[x]) * BigInt(R[y]); hi = Number(BigInt.asUintN(32, p >> 32n)); lo = Number(BigInt.asUintN(32, p)); break; }
      case 'DIVU': { lo = u(Math.floor(R[x] / R[y])); hi = u(R[x] % R[y]); break; }
      case 'MFHI': set(x, hi); break;
      case 'MFLO': set(x, lo); break;
      case 'MTHI': hi = R[x]; break;
      case 'MTLO': lo = R[x]; break;
      case 'LW': set(x, rd(R[z] + y)); break;
      case 'SW': M.set(u(R[z] + y), R[x]); break;
      case 'LB': case 'LBU': { const a = u(R[z] + y), b = (rd(a) >>> ((3 - (a & 3)) * 8)) & 0xFF; set(x, op === 'LB' ? (b << 24) >> 24 : b); break; }
      case 'SB': { const a = u(R[z] + y), sh = (3 - (a & 3)) * 8, wa = u(a & ~3); M.set(wa, u(((M.get(wa) || 0) & ~(0xFF << sh)) | ((R[x] & 0xFF) << sh))); break; }
      case 'LH': case 'LHU': { const a = u(R[z] + y), v = (rd(a) >>> ((a & 2) ? 0 : 16)) & 0xFFFF; set(x, op === 'LH' ? (v << 16) >> 16 : v); break; }
      case 'SH': { const a = u(R[z] + y), sh = (a & 2) ? 0 : 16, wa = u(a & ~3); M.set(wa, u(((M.get(wa) || 0) & ~(0xFFFF << sh)) | ((R[x] & 0xFFFF) << sh))); break; }
      case 'BEQ': if (R[x] === R[y]) next = L[3]; break;
      case 'BNE': if (R[x] !== R[y]) next = L[3]; break;
      case 'BLEZ': if (s(R[x]) <= 0) next = L[3]; break;
      case 'BGTZ': if (s(R[x]) > 0) next = L[3]; break;
      case 'BLTZ': if (s(R[x]) < 0) next = L[3]; break;
      case 'BGEZ': if (s(R[x]) >= 0) next = L[3]; break;
      case 'NOP': break;
    }
    if (trap) break;
    i = next;
  }
  return { regs: R, mem: M, hi, lo, trap };
}
// ランダムなプログラムを、参照実装用の命令列とアセンブリ文字列の両方で作る
// $28 = データ領域の先頭（書き換えない）、$27 は DIV の除数を 0 にしないための作業用
// ADD / SUB / ADDI はオーバーフロー例外で止まりやすいので、出現頻度を下げる
function genProgram(len, pipeSafe) {
  const ops = [], out = [];
  const dst = () => 1 + rnd(26);           // $1〜$26 に書く
  const src = () => rnd(27);               // $0〜$26 を読む
  const emit = (op, text) => { ops.push(op); out.push(text); };
  const noTarget = new Set();   // 分岐の飛び先にしてはいけない位置（ORI と DIV の間など）
  for (let k = 0; k < len; k++) {
    const t = rnd(14);
    if (t < 3) {
      const m = rnd(8) ? pick(['ADDU', 'SUBU', 'AND', 'OR', 'XOR', 'NOR', 'SLT', 'SLTU']) : pick(['ADD', 'SUB']);
      const [a, b, c] = [dst(), src(), src()]; emit([m, a, b, c], `${m} $${a}, $${b}, $${c}`);
    }
    else if (t < 4) {
      if (rnd(2)) { const m = pick(['SLL', 'SRL', 'SRA']); const [a, b, c] = [dst(), src(), rnd(32)]; emit([m, a, b, c], `${m} $${a}, $${b}, ${c}`); }
      else { const m = pick(['SLLV', 'SRLV', 'SRAV']); const [a, b, c] = [dst(), src(), src()]; emit([m, a, b, c], `${m} $${a}, $${b}, $${c}`); }
    }
    else if (t < 6) {
      const m = rnd(8) ? pick(['ADDIU', 'SLTI', 'SLTIU', 'ANDI', 'ORI', 'XORI']) : 'ADDI';
      const [a, b] = [dst(), src()]; const c = rnd(65536) - 32768; emit([m, a, b, c], `${m} $${a}, $${b}, ${c}`);
    }
    else if (t < 7) { const a = dst(), c = rnd(65536); emit(['LUI', a, c], `LUI $${a}, ${c}`); }
    else if (t < 8) {
      const [a, b] = [src(), src()];
      if (rnd(2)) { const m = pick(['MULT', 'MULTU']); emit([m, a, b], `${m} $${a}, $${b}`); }
      else { const m = pick(['DIV', 'DIVU']); emit(['ORI', 27, b, 1], `ORI $27, $${b}, 1`); noTarget.add(ops.length); emit([m, a, 27], `${m} $${a}, $27`); }
      const m = pick(['MFHI', 'MFLO']), d = dst(); emit([m, d], `${m} $${d}`);
    }
    else if (t < 9) { const m = pick(['MTHI', 'MTLO']); const a = src(); emit([m, a], `${m} $${a}`); }
    else if (t < 11) {
      const m = pick(['LW', 'SW', 'LB', 'LBU', 'SB', 'LH', 'LHU', 'SH']);
      const off = (m === 'LW' || m === 'SW') ? rnd(16) * 4 : m[1] === 'H' ? rnd(32) * 2 : rnd(64);
      const r = m[0] === 'S' ? src() : dst();
      emit([m, r, off, 28], `${m} $${r}, ${off}($28)`);
      if (pipeSafe && m[0] === 'L') emit(['NOP'], 'NOP');      // 遅延ロード
    }
    else if (t < 12 && k < len - 4) {
      // 前方への条件分岐（飛び先は後で番号を決める）
      const m = pick(['BEQ', 'BNE', 'BEQ', 'BNE', 'BLEZ', 'BGTZ', 'BLTZ', 'BGEZ']), a = src(), b = m.length === 3 ? (rnd(3) ? src() : a) : null;
      emit([m, a, b, null], { branch: m, a, b });
      if (pipeSafe) emit(['NOP'], 'NOP');                      // 遅延スロット
    }
    else { emit(['NOP'], 'NOP'); }
  }
  // 分岐の飛び先: 自分より後ろのどこか（終端も可）
  const isBr = op => /^B/.test(op[0]);
  ops.forEach((op, i) => {
    if (!isBr(op)) return;
    let target = Math.min(ops.length, i + 2 + rnd(6));
    while (noTarget.has(target)) target++;
    op[3] = target;
    const o = out[i];
    const label = target < ops.length ? 'L' + target : 'END';
    out[i] = o.b === null ? `${o.branch} $${o.a}, ${label}` : `${o.branch} $${o.a}, $${o.b}, ${label}`;
  });
  const text = out.map((t, i) => (ops.some(o => isBr(o) && o[3] === i) ? `L${i}: ` : '') + t);
  text.push('END: NOP');
  ops.push(['NOP']);
  return { ops, text: text.join('\n') };
}
function randomState() {
  const regs = new Array(32).fill(0).map((_, i) => i === 0 ? 0 : (rnd(3) ? rnd(0x10000) * 0x10000 + rnd(0x10000) : rnd(20) - 10) >>> 0);
  regs[28] = DATA;
  const mem = new Map();
  for (let k = 0; k < 16; k++) mem.set(DATA + 4 * k, (rnd(0x10000) * 0x10000 + rnd(0x10000)) >>> 0);
  return { regs, mem };
}
function simRun(text, mode, st0, opts = {}) {
  const a = assemble(text, {});
  if (a.errors.length) return { err: JSON.stringify(a.errors) };
  const initMem = [...st0.mem].map(([address, value]) => ({ address, value }));
  const m = Sim.createMachine({ words: a.words, initRegs: st0.regs, initMem, mode, delaySlot: opts.delaySlot, loadUse: opts.loadUse });
  for (let i = 0; i < 20000 && !m.state.halted; i++) m.step();
  return m.state;
}
const isTrap = s => s.haltError && /オーバーフロー/.test(s.haltReason);
function sameState(x, y) {
  const diffs = [];
  for (let i = 0; i < 32; i++) if ((x.regs[i] >>> 0) !== (y.regs[i] >>> 0)) diffs.push(`$${i}: ${h(x.regs[i])} / ${h(y.regs[i])}`);
  if ((x.hi >>> 0) !== (y.hi >>> 0)) diffs.push(`HI ${h(x.hi)} / ${h(y.hi)}`);
  if ((x.lo >>> 0) !== (y.lo >>> 0)) diffs.push(`LO ${h(x.lo)} / ${h(y.lo)}`);
  for (let k = 0; k < 16; k++) {
    const a = DATA + 4 * k;
    if (((x.mem.get(a) || 0) >>> 0) !== ((y.mem.get(a) || 0) >>> 0)) diffs.push(`M[${h(a)}]: ${h(x.mem.get(a) || 0)} / ${h(y.mem.get(a) || 0)}`);
  }
  return diffs;
}
{
  let bad = 0, first = '', traps = 0;
  for (let t = 0; t < 300; t++) {
    const p = genProgram(30, false);
    const st0 = randomState();
    const ref = refRun(p.ops, st0.regs, st0.mem);
    const s = simRun(p.text, 'seq', st0);
    if (ref.trap) traps++;
    if (s.err || (s.haltError && !isTrap(s)) || isTrap(s) !== ref.trap) {
      bad++; first = first || `停止の違い ${s.err || s.haltReason} / 参照 trap=${ref.trap}\n${p.text}`; continue;
    }
    const d = sameState(ref, s);
    if (d.length) { bad++; first = first || d.slice(0, 4).join(', ') + '\n' + p.text; }
  }
  check('参照実装と逐次モードの一致（ランダム 300 本）', bad === 0, `${bad} 本不一致。例: ${first}`);
  check('ランダムプログラムにオーバーフロー例外を含む', traps > 10 && traps < 200, `traps=${traps}`);
}
// --- 3. 逐次とパイプラインの一致 ---
// 遅延分岐・遅延ロードを使う設定では、遅延スロットとロード直後に NOP を入れたプログラムを使う
function compareSeqPipe(name, pipeSafe, seqOpts, pipeOpts) {
  let bad = 0, first = '';
  for (let t = 0; t < 300; t++) {
    const p = genProgram(30, pipeSafe);
    const st0 = randomState();
    const a = simRun(p.text, 'seq', st0, seqOpts), b = simRun(p.text, 'pipe', st0, pipeOpts);
    if (a.err || (a.haltError && !isTrap(a)) || (b.haltError && !isTrap(b)) || isTrap(a) !== isTrap(b)) {
      bad++; first = first || `停止の違い ${a.err || a.haltReason} / ${b.haltReason}\n${p.text}`; continue;
    }
    const d = sameState(a, b);
    if (d.length) { bad++; first = first || d.slice(0, 4).join(', ') + '\n' + p.text; }
  }
  check(`逐次とパイプラインの一致: ${name}（ランダム 300 本）`, bad === 0, `${bad} 本不一致。例: ${first}`);
}
compareSeqPipe('既定（ストール・フラッシュ、NOP なし）', false, {}, {});
compareSeqPipe('遅延分岐・遅延ロード（NOP あり）', true, { delaySlot: true }, { delaySlot: true, loadUse: 'delay' });
compareSeqPipe('遅延分岐・ストール（NOP あり）', true, { delaySlot: true }, { delaySlot: true, loadUse: 'stall' });

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
