# MIPS Assembler / Simulator

English | [日本語](README.md)

[![test](https://github.com/quwon-000/MIPS-pipeline-simulator/actions/workflows/test.yml/badge.svg)](https://github.com/quwon-000/MIPS-pipeline-simulator/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A MIPS assembler and simulator that runs entirely in the browser. It is designed for learning computer architecture, especially pipelining: it translates assembly into machine code (hex) and lets you follow, clock by clock, how instructions flow through single-cycle execution and a 5-stage pipeline.

**Demo: https://quwon-000.github.io/MIPS-pipeline-simulator/**

> The user interface is in Japanese. Instruction names, registers, hex values and the pipeline diagram (IF / ID / EX / MEM / WB) are language-independent.

![Pipeline diagram](images/screenshot-pipeline.png)

## Purpose and audience

Pipeline hazards and forwarding are hard to follow from textbook figures alone. This tool aims to make them visible: you can see, clock by clock, how each instruction advances and which value is passed where, through diagrams and tables.

- **Audience**: students learning computer architecture, and the people who teach it
- **Priorities**: clarity of what happens, stepping forwards and backwards one step at a time, and correctness verified by tests
- **Non-goals**: cycle-accurate modelling of real processors, or running large programs fast

## Features

- **No installation**: a single HTML file with no external libraries.
- **Assembler**
  - 54 MIPS I integer instructions (MIPS32 encoding) and MARS / SPIM compatible pseudo-instructions (`LI`, `LA`, `MOVE`, `BLT`, ...)
  - Directives such as `.data`, `.word` and `.asciiz`, and memory access by label (`LW $t0, ARRAY+4`)
  - Bit-field view of every instruction (op / rs / rt / ...) and error messages with line numbers
  - An input helper for picking instructions and registers from drop-down lists
- **Simulator**
  - Single-cycle execution and a 5-stage pipeline (IF / ID / EX / MEM / WB)
  - Forwarding, load-use stalls and flushing on taken branches
  - Optional delayed branches and delayed loads (MIPS I behaviour)
  - Arithmetic overflow exceptions, `SYSCALL` (output / exit) and `BREAK`
- **Visualization and debugging**
  - Pipeline diagram (instructions × clock cycles, showing stalls, flushed instructions and forwarding sources)
  - Value table: initial value and every clock cycle side by side, with selectable rows (pipeline registers, general-purpose registers, memory addresses) and a clock limit. Columns can also be switched to "each time a chosen instruction passes" (1st, 2nd, ... pass) to compare loop iterations. Copyable as TSV
  - Datapath view: pipeline register values on the stage boundaries (`IF/ID.PC`, `ID/EX.A`, `EX/MEM.ALUOut`, ...) with the forwarding, branch, memory and write-back paths highlighted at every clock
  - Breakpoints, stepping backwards, and editing registers / memory during execution

![Datapath view](images/screenshot-datapath.png)

![Machine code view](images/screenshot-main.png)

## Usage

1. Open the [demo](https://quwon-000.github.io/MIPS-pipeline-simulator/) (or open `index.html` in a browser).
2. Write assembly in the editor on the left (sample programs are available from the drop-down at the top).
3. Press "ステップ" (Step, F10) to run one instruction / one clock, or "▶ 実行" (Run, F9) to run to the end.

```asm
        .data
ARRAY:  .word   3, 1, 4, 1, 5
MSG:    .asciiz "Sum = "
        .text
MAIN:   LA      $a0, MSG
        LI      $v0, 4
        SYSCALL                 # print string
        LW      $t0, ARRAY+4    # $t0 = 1
```

## Supported instructions

| Kind | Instructions |
|---|---|
| Arithmetic / logic | `ADD` `ADDU` `SUB` `SUBU` `AND` `OR` `XOR` `NOR` `SLT` `SLTU` `ADDI` `ADDIU` `SLTI` `SLTIU` `ANDI` `ORI` `XORI` `LUI` |
| Shift | `SLL` `SRL` `SRA` `SLLV` `SRLV` `SRAV` |
| Multiply / divide | `MULT` `MULTU` `DIV` `DIVU` `MFHI` `MFLO` `MTHI` `MTLO` |
| Memory | `LW` `LH` `LHU` `LB` `LBU` `SW` `SH` `SB` |
| Branch / jump | `BEQ` `BNE` `BLEZ` `BGTZ` `BLTZ` `BGEZ` `BLTZAL` `BGEZAL` `J` `JAL` `JR` `JALR` |
| Other | `SYSCALL` `BREAK` |
| Pseudo | `NOP` `LI` `LA` `MOVE` `NOT` `NEG` `NEGU` `MUL` `DIV` (3 operands) `B` `BEQZ` `BNEZ` `BLT` `BGE` `BGT` `BLE` `BLTU` `BGEU` `BGTU` `BLEU` |
| Directives | `.text` `.data` `.word` `.half` `.byte` `.ascii` `.asciiz` `.space` `.align` `.globl` |

`SYSCALL` supports `$v0` = 1 (print integer), 4 (print string), 10 (exit), 11 (print character), 17 (exit with code) and 34 (print hex).

## Pipeline design

| Item | Behaviour |
|---|---|
| Branch resolution | ID stage |
| Forwarding | From EX, MEM and WB to ID (newest result wins) |
| Load-use hazard | 1-cycle stall (or MIPS I delayed load, configurable) |
| Taken branch | Flush the already-fetched instruction (or delayed branch, configurable) |
| Exceptions / exit | Older instructions complete, younger instructions are discarded |

### Differences from the textbook 5-stage pipeline

Pipeline register names follow the textbook notation (Patterson & Hennessy, *Computer Organization and Design*), but some details, such as where forwarding happens, differ from the textbook's standard design.

| Item | This tool | Standard textbook design |
|---|---|---|
| Forwarding destination | **ID stage** (results from EX, MEM and WB are received in ID, so `ID/EX.A` and `ID/EX.B` hold the forwarded values) | Inputs of the EX stage (from EX/MEM and MEM/WB to the ALU) |
| Branch on the result of the previous ALU instruction | **No stall** | 1-cycle stall (with branches resolved in ID) |
| Branch on the result of the previous load | **1-cycle** stall | 2-cycle stall |
| ALU instruction right after a load | 1-cycle stall | 1-cycle stall (same) |
| MEM/WB | A single write-back value (`MEM/WB.Result`) | Read data and ALU result kept separately |
| Exceptions | Execution stops | EPC is saved and control jumps to the exception handler |

Forwarding into ID lets a branch compare against an EX result within the same cycle, which removes branch stalls. The trade-off is a longer combinational path in one cycle (ALU → select → compare), which would limit the clock frequency of real hardware. For readability, the datapath view omits the immediate / sign-extension path and the control signals.

## Tests

```sh
npm test    # or: node test/assembler.test.js (Node.js 18+, no dependencies)
```

The tests extract the assembler and simulator scripts from `index.html` and run 244 checks:

- **Encoding**: machine code of every instruction matches the MIPS32 specification
- **Round trip**: 3,000 random instructions are assembled, disassembled and re-assembled to the same word
- **Reference model**: 300 random programs are compared against an independent, straightforward implementation of the instruction semantics
- **Single-cycle vs. pipeline**: the same programs produce identical registers and memory in both modes (three configurations)
- **Pipeline timing**: pipeline register values at each clock and the position of stalls and flushes

Use `SEED=1 npm test` to change the random seed.

## Project structure

```
index.html                 The application (assembler, simulator and UI)
test/assembler.test.js     Tests
images/                    Images for the README
```

## Not supported

The scope is limited to what is needed for learning, so the following are not supported:

- Floating-point instructions (coprocessor 1) and exception handlers (execution stops on an exception)
- Input `SYSCALL`s (5, 8, 12, ...)

## License

[MIT](LICENSE)
