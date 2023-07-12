export class UndoStack<T extends Record<string, unknown>> {
  /**
   * @param isTransition 操作の記録ならtrue, 状態の記録ならfalse。
   *   操作の記録か状態の記録かについて;
   *   操作の記録の場合:
   *   currentIndex <= -1 の場合にUndoできません。
   *   undo時にreverse(data);を通したデータが返ります。
   *   状態の記録の場合:
   *   currentIndex <= 0 の場合にUndoできません。
   *   reverseは通されません。
   */
  constructor(private isTransition: boolean) {
    this.clear();
  }

  get canUndo() {
    return this.index >= (this.isTransition ? 0 : 1);
  }

  get canRedo() {
    return this.index < this.stack.length - 1;
  }

  get current() {
    return this.stack[this.index];
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
    return this.isTransition
      ? this.reverse(this.stack[this.index + 1])
      : this.stack[this.index];
  }

  /**
   * @returns 履歴がない場合`undefined`を返す。
   */
  redo(): Readonly<T> | undefined {
    if (!this.canRedo) return undefined;
    this.index += 1;
    return this.stack[this.index];
  }

  protected reverse(data: T): T {
    return data;
  }

  private stack: T[] = [];
  private index = -1;
}

import { QInput } from "quasar";

type QInputUndoData = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

// FIXME: 再現できていない挙動
//   範囲選択状態から全角入力したあとundoすると、一回範囲削除されてからIMEが追加される挙動が再現できていない
export class QInputUndoStack extends UndoStack<QInputUndoData> {
  constructor() {
    super(false);
  }

  lookAt(qInput: QInput) {
    this.isListening = true;
    const nativeEl = qInput.nativeEl;
    if (nativeEl === undefined) {
      throw new Error("nativeEl の取得に失敗しました。");
    }
    this._nativeEl = nativeEl;
    this.clear();

    return this._nativeEl;
  }

  stopListening() {
    this.isListening = false;
  }

  /**
   * 直前の入力タイプと比較し、違ったなら追加する。
   * @param inputType 入力タイプ。`undefined`なら必ず追加する。
   * @returns 追加されたなら`true`、されなかったら`false`を返す。
   */
  pushIfNeeded(inputType: string | undefined) {
    if (
      this.inputTypeBefore === "insertWhiteSpace" &&
      inputType === "insertString"
    ) {
      this.inputTypeBefore = inputType;
      return false;
    }
    // 入力の種類の「境目」なら
    if (
      this.inputTypeBefore !== "redo" &&
      (inputType === undefined || this.inputTypeBefore !== inputType)
    ) {
      const text = this.nativeEl.value;
      this.inputTypeBefore = inputType;
      if (this.inputTypeBefore === "undo" && this.current.value === text) {
        return false;
      }
      console.log("push: " + text);
      super.push({
        value: text,
        selectionStart: this.selectionStart,
        selectionEnd: this.selectionEnd,
      });
      return true;
    }
    return false;
  }

  undo() {
    console.log("try undo");
    if (this.pushIfNeeded("undo") || this.canUndo) {
      return this.action(super.undo());
    }
    console.log("履歴なし");
    return undefined;
  }

  redo() {
    console.log("try redo");
    this.inputTypeBefore = "redo";
    return this.action(super.redo());
  }

  setEventListener(element: HTMLElement) {
    // 一つの入力に対しての発火順で上から並んでいます

    element.addEventListener("compositionstart", () => {
      if (!this.isListening) return;
      this.pushIfNeeded(undefined);
    });

    // NOTE: <input type="text">でそもそも受け付けない改行を入力された場合や
    //       範囲選択なしで切り取りされた場合などは発火しない
    element.addEventListener("beforeinput", (event: InputEvent) => {
      if (!this.isListening) return;

      // 選択範囲の取得
      const isRangedSelection = this.selectionStart !== this.selectionEnd;

      if (!(event instanceof InputEvent)) {
        throw new Error("inputイベントを検出できませんでした。");
      }
      switch (event.inputType) {
        case "insertCompositionText": // IME中
          // 各専用イベントで判定
          return;
        case "deleteByDrag": // テキスト欄内で範囲選択→ドラッグで位置を移動した時
          // "insertFromDrop" が直後に実行されるため
          return;
        case "deleteContentBackward": //  削除 (BackSpace) or 範囲削除 (BackSpace / Delete)
        case "deleteContentForward": // 削除 (Delete)
          // 範囲選択されていたなら絶対
          // 範囲選択でないなら前のイベントと比較
          this.pushIfNeeded(isRangedSelection ? undefined : event.inputType);
          return;
        case "insertLineBreak": // 改行 (event.data === null)
        case "deleteByCut": // 切り取り
        case "insertFromPaste": // 貼り付け
        case "insertFromDrop": // ドロップ
        case "deleteWordBackward": // 単語単位で削除 (Ctrl + BackSpace)
        case "deleteWordForward": // 単語単位で削除 (Ctrl + Delete)
          this.pushIfNeeded(undefined);
          return;
      }
      // キーボード入力
      if (event.data !== null) {
        this.pushIfNeeded(
          event.data === " " ? "insertWhiteSpace" : "insertString"
        );
        return;
      }
      throw new Error(
        "想定外のinputTypeのイベントが発生したため、Undo操作が正常に行えません。"
      );
    });

    // IME
    element.addEventListener("compositionend", () => {
      if (!this.isListening) return;
      this.pushIfNeeded(undefined);
    });
  }

  get nativeEl() {
    if (this._nativeEl === undefined) {
      throw new Error("nativeElが未定義です");
    }
    return this._nativeEl;
  }

  private action(data: QInputUndoData | undefined) {
    if (data === undefined) {
      console.log("履歴なし");
      return data;
    }

    this.nativeEl.value = data.value;
    this.nativeEl.selectionStart = data.selectionStart;
    this.nativeEl.selectionEnd = data.selectionEnd;
    return data;
  }

  private _nativeEl: HTMLInputElement | HTMLTextAreaElement | undefined;
  private inputTypeBefore: string | undefined = undefined;
  private isListening = false;
  private get selectionStart() {
    return this.nativeEl.selectionStart ?? 0;
  }
  private get selectionEnd() {
    return this.nativeEl.selectionEnd ?? 0;
  }
}
