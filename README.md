# MIPS アセンブラ / シミュレータ

[English](README.en.md) | 日本語

[![test](https://github.com/quwon-000/MIPS-pipeline-simulator/actions/workflows/test.yml/badge.svg)](https://github.com/quwon-000/MIPS-pipeline-simulator/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

ブラウザだけで動く MIPS のアセンブラ / シミュレータです。アセンブリを機械語（16 進）に変換し、逐次実行と 5 段パイプラインの動きをクロックごとに確認できます。

**デモ: https://quwon-000.github.io/MIPS-pipeline-simulator/**

![パイプライン図](images/screenshot-pipeline.png)

## 特徴

- **インストール不要**：HTML 1 ファイルで完結し、外部ライブラリも使っていません。
- **アセンブラ**
  - MIPS I の整数命令 54 種（MIPS32 のエンコーディング）と、MARS / SPIM 互換の擬似命令（`LI` `LA` `MOVE` `BLT` など）
  - `.data` `.word` `.asciiz` などのディレクティブと、ラベルを使ったメモリアクセス（`LW $t0, ARRAY+4`）
  - 命令ごとのビットフィールド（op / rs / rt / …）の表示、行番号付きのエラーメッセージ
  - 命令とレジスタをプルダウンで選んで入力できる「入力補助」
- **シミュレータ**
  - 逐次実行と、IF / ID / EX / MEM / WB の 5 段パイプライン
  - フォワーディング、ロード直後の依存のストール、分岐成立時のフラッシュ
  - 遅延分岐・遅延ロード（MIPS I の動作）への切り替え
  - 算術オーバーフロー例外、`SYSCALL`（出力・終了）、`BREAK`
- **可視化とデバッグ**
  - パイプライン図（命令 × クロック。ストール・破棄・フォワーディング元を表示）
  - パイプラインレジスタ（`IF/ID.PC` `ID/EX.A` `EX/MEM.ALUOut` …）の値
  - ブレークポイント、1 ステップずつ戻る、実行途中でのレジスタ・メモリの書き換え

![機械語の表示](images/screenshot-main.png)

## 使い方

1. [デモ](https://quwon-000.github.io/MIPS-pipeline-simulator/) を開く（または `index.html` をブラウザで開く）。
2. 左のエディタにアセンブリを書く（エディタ上部の「サンプルを読み込む…」で例を読み込めます）。
3. 「ステップ」（F10）で 1 命令 / 1 クロックずつ、「▶ 実行」（F9）で最後まで実行します。

```asm
        .data
ARRAY:  .word   3, 1, 4, 1, 5
MSG:    .asciiz "合計 = "
        .text
MAIN:   LA      $a0, MSG
        LI      $v0, 4
        SYSCALL                 # 文字列を出力
        LW      $t0, ARRAY+4    # $t0 = 1
```

詳しい書き方は、エディタ上部の「?」（ヘルプ）にまとめています。

## 対応している命令

| 種類 | 命令 |
|---|---|
| 演算 | `ADD` `ADDU` `SUB` `SUBU` `AND` `OR` `XOR` `NOR` `SLT` `SLTU` `ADDI` `ADDIU` `SLTI` `SLTIU` `ANDI` `ORI` `XORI` `LUI` |
| シフト | `SLL` `SRL` `SRA` `SLLV` `SRLV` `SRAV` |
| 乗除算 | `MULT` `MULTU` `DIV` `DIVU` `MFHI` `MFLO` `MTHI` `MTLO` |
| メモリ | `LW` `LH` `LHU` `LB` `LBU` `SW` `SH` `SB` |
| 分岐・ジャンプ | `BEQ` `BNE` `BLEZ` `BGTZ` `BLTZ` `BGEZ` `BLTZAL` `BGEZAL` `J` `JAL` `JR` `JALR` |
| その他 | `SYSCALL` `BREAK` |
| 擬似命令 | `NOP` `LI` `LA` `MOVE` `NOT` `NEG` `NEGU` `MUL` `DIV`（3 オペランド） `B` `BEQZ` `BNEZ` `BLT` `BGE` `BGT` `BLE` `BLTU` `BGEU` `BGTU` `BLEU` |
| ディレクティブ | `.text` `.data` `.word` `.half` `.byte` `.ascii` `.asciiz` `.space` `.align` `.globl` |

`SYSCALL` は `$v0` = 1（整数出力）、4（文字列出力）、10（終了）、11（文字出力）、17（終了コード付き終了）、34（16 進出力）に対応しています。

## パイプラインの設計

| 項目 | 動作 |
|---|---|
| 分岐の判定 | ID ステージ |
| フォワーディング | EX・MEM・WB の結果を ID へ（優先順位は新しい順） |
| ロード直後の依存 | 1 クロックストール（設定で MIPS I の遅延ロードに変更可） |
| 分岐成立時 | フェッチ済みの 1 命令をフラッシュ（設定で遅延分岐に変更可） |
| 例外・終了 | 先行する命令は完了させ、後続の命令は捨てる |

## テスト

```sh
npm test    # または node test/assembler.test.js（Node.js 18 以上、依存パッケージなし）
```

`index.html` からアセンブラとシミュレータのスクリプトを取り出して検証します（244 項目）。

- **エンコーディング**：命令ごとの機械語が MIPS32 の仕様どおりか
- **往復テスト**：ランダムな 3000 命令を「アセンブル → 逆アセンブル → 再アセンブル」して同じ機械語になるか
- **参照実装との比較**：命令の意味を素直に書いた別実装と、ランダムな 300 本のプログラムで結果を比べる
- **逐次とパイプラインの一致**：同じプログラムを両方で実行し、レジスタ・メモリが一致するか（実行方式の 3 通りの組み合わせ）
- **パイプラインのタイミング**：各クロックのパイプラインレジスタの値、ストール・フラッシュの位置

乱数の種は `SEED=1 npm test` のように変えられます。

## ファイル構成

```
index.html                 アプリ本体（アセンブラ・シミュレータ・UI）
test/assembler.test.js     テスト
images/                    README 用の画像
```

## 対応していないもの

- 浮動小数点命令（コプロセッサ 1）、例外ハンドラ（例外が起きると停止します）
- 入力を受け取る `SYSCALL`（5・8・12 など）

## ライセンス

[MIT](LICENSE)
