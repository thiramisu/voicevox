export class UndoStack<T extends Record<string, unknown>> {
  get canUndo() {
    return this.index >= 0;
  }

  get canRedo() {
    return this.index < this.stack.length - 1;
  }

  push(payload: T) {
    this.index += 1;
    this.stack[this.index] = payload;
    // 操作以降の履歴の削除
    this.stack.length = this.index + 1;
  }

  clear() {
    this.stack = [];
    this.index = -1;
  }

  /**
   * @returns 履歴がない場合`undefined`を返す。
   */
  undo(): Readonly<T> | undefined {
    if (!this.canUndo) return undefined;
    this.index -= 1;
    return this.reverse(this.stack[this.index + 1]);
  }

  /**
   * @returns 履歴がない場合`undefined`を返す。
   */
  redo(): Readonly<T> | undefined {
    if (!this.canRedo) return undefined;
    this.index += 1;
    return this.stack[this.index];
  }

  reverse(data: T): T {
    return data;
  }

  private stack: T[] = [];
  private index = -1;
}

import { QInput } from "quasar";

type EditDirection = "start" | "end";
type QInputUndoData = {
  textBefore?: string; // 何のテキストが変わったか
  textAfter?: string; // 何のテキストに変わったか
  selectionBasePoint?: number; // 入力の基準点
  editDirection?: EditDirection; // 操作終了時に、変更されたテキストの最初と最後のどちらにカーソルがあるか
  isSelectedBefore?: boolean; // 変わる前に範囲選択されていたか
  isSelectedAfter?: boolean; // 変わった後に範囲選択されていたか
};

// FIXME: 再現できていない挙動
//   undo時の範囲指定
//   範囲選択状態から全角入力したあとundoすると、一回範囲削除されてからIMEが追加される挙動が再現できていない

// NOTE: <input type="text">ではそもそも受け付けない改行などではonInputイベントが発火しない
export class QInputUndoStack extends UndoStack<QInputUndoData> {
  constructor(private qInput: QInput) {
    super();
  }

  push(
    {
      textBefore,
      textAfter,
      selectionBasePoint,
      editDirection,
      isSelectedBefore,
      isSelectedAfter,
    }: QInputUndoData = {
      textBefore: this.selectionText,
      textAfter: "",
      selectionBasePoint: this.selectionStart,
      editDirection: "end",
      isSelectedBefore: this.selectionText.length > 0,
      isSelectedAfter: false,
    }
  ) {
    super.push({
      textBefore,
      textAfter,
      selectionBasePoint,
      editDirection,
      isSelectedBefore,
      isSelectedAfter,
    });
  }

  reverse(data: QInputUndoData) {
    return {
      textBefore: data.textAfter,
      textAfter: data.textBefore,
      isSelectedBefore: data.isSelectedAfter,
      isSelectedAfter: data.isSelectedBefore,
      selectionBasePoint: data.selectionBasePoint,
      editDirection: data.editDirection,
    };
  }

  setEventListener(element: HTMLInputElement) {
    // 一つの入力に対しての発火順で上から並んでいます

    // 貼り付け時にクリップボードのデータだけ取っておく
    element.addEventListener("paste", (event: ClipboardEvent) => {
      this.textAfter = event.clipboardData?.getData("text") ?? "";
    });

    // 選択範囲の取得
    element.addEventListener("beforeinput", (event: InputEvent) => {
      this.isRangedSelection = this.selectionStart !== this.selectionEnd;

      if (this.isRangedSelection) {
        this.selectionText = this.nativeEl.value.slice(
          this.selectionStart,
          this.selectionEnd
        );
      } else {
        // 範囲選択なしの場合の削除(BackSpace/Delete) 準備
        switch (event.inputType) {
          // 削除準備 (BackSpace)
          case "deleteContentBackward":
            this.selectionText = this.nativeEl.value.slice(
              this.selectionStart - 1,
              this.selectionEnd
            );
            return;
          // 削除準備 (Delete)
          case "deleteContentForward":
            this.selectionText = this.nativeEl.value.slice(
              this.selectionStart,
              this.selectionEnd + 1
            );
            return;
          // TODO: "deleteWordBackward" (Ctrl + BackSpace)
          // TODO: "deleteWordForward" (Ctrl + Delete)
        }
        this.selectionText = "";
      }
    });

    // FIXME: 型エラー
    element.addEventListener("input", (event: InputEvent) => {
      switch (event.inputType) {
        // IME中
        case "insertCompositionText":
          // 各専用イベントで判定
          return;
        // 改行 (event.data === null)
        case "insertLineBreak":
          this.push({
            // textareaの改行コードはOSに関係なく`\n`らしい
            textAfter: "\n",
          });
          return;
        // 切り取り / 削除 (BackSpace) or 範囲削除 (BackSpace / Delete)
        case "deleteByCut":
        case "deleteContentBackward":
          this.push();
          return;
        // 削除 (Delete)
        case "deleteContentForward":
          this.push({
            editDirection: "start",
          });
          return;
        // 貼り付け
        case "insertFromPaste":
          this.push({
            textAfter: this.textAfter,
          });
          // クリップボードのデータなので一応削除
          this.textAfter = "";
          return;
        // テキスト欄内で範囲選択→ドラッグで位置を移動した時
        case "deleteByDrag":
          this.push();
          return;
        // ドロップ
        case "insertFromDrop":
          // TODO: 直前のイベントが"deleteByDrag"だったら2つ飛ばす
          this.push({
            textBefore: "",
            textAfter: this.nativeEl.value.slice(
              this.selectionStart,
              this.selectionEnd
            ),
            isSelectedAfter: true,
          });
          return;
      }
      // キーボード入力
      if (event.data !== null) {
        this.push({
          textAfter: event.data,
        });
        return;
      }
      throw new Error(
        "想定外のinputTypeのイベントが発生したため、Undo操作が正常に行えません。"
      );
    });

    // IME
    element.addEventListener("compositionstart", (event: CompositionEvent) => {
      this.imeBefore = event.data;
    });
    element.addEventListener("compositionend", (event: CompositionEvent) => {
      // 入力を取り消した場合
      if (this.imeBefore === event.data) {
        return;
      }
      this.push({
        textBefore: this.imeBefore,
        textAfter: event.data,
        isSelectedBefore: false,
      });
    });
  }

  get nativeEl() {
    return this._nativeEl || this.initAndGetNativeEl();
  }

  private initAndGetNativeEl() {
    const nativeEl = this.qInput.nativeEl;
    if (nativeEl === undefined) {
      throw new Error("nativeEl の取得に失敗しました。");
    }
    this._nativeEl = nativeEl;

    return this._nativeEl;
  }

  private _nativeEl: HTMLInputElement | HTMLTextAreaElement | undefined;
  private selectionText = "";
  private textAfter = "";
  private isRangedSelection = false;
  private imeBefore = "";
  private get selectionStart() {
    return this.nativeEl.selectionStart ?? 0;
  }
  private get selectionEnd() {
    return this.nativeEl.selectionEnd ?? 0;
  }
}
