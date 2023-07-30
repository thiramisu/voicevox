import { QVueGlobals } from "quasar";
import { AudioKey, SaveMediaType, mediaTypeNames } from "@/type/preload";
import {
  AllGetters,
  AllActions,
  SaveResultObject,
  SaveResult,
  ErrorTypeForSaveAllResultDialog,
  FilePath,
  DirPath,
  FileName,
} from "@/store/type";
import SaveAllResultDialog from "@/components/SaveAllResultDialog.vue";
import { Dispatch } from "@/store/vuex";
import { withProgress } from "@/store/ui";
import { Result, failure, success } from "@/type/result";

type QuasarDialog = QVueGlobals["dialog"];
type QuasarNotify = QVueGlobals["notify"];

export async function generateAndSaveOneAudioWithDialog({
  audioKey,
  quasarDialog,
  quasarNotify,
  dispatch,
  getters,
  disableNotifyOnGenerate,
}: {
  audioKey: AudioKey;
  quasarDialog: QuasarDialog;
  quasarNotify: QuasarNotify;
  dispatch: Dispatch<AllActions>;
  getters: AllGetters;
  disableNotifyOnGenerate: boolean;
}): Promise<void> {
  const defaultName = getters.DEFAULT_AUDIO_FILE_NAME(audioKey);
  let filePath = await getters.FIXED_FILE_PATH(defaultName);
  if (!filePath) {
    const filePathResult = await getFilePathWithDialog({
      defaultName,
      mediaType: "audio",
      title: "音声を保存",
    });
    if (!filePathResult.ok) return;
    filePath = filePathResult.value;
  }

  const result = await withProgress(
    dispatch("GENERATE_AND_SAVE_AUDIO", {
      audioKey,
      filePath,
    }),
    dispatch
  );

  if (result.result === "SUCCESS") {
    if (disableNotifyOnGenerate) return;
    // 書き出し成功時に通知をする
    showNotify({
      mediaType: "audio",
      quasarNotify,
      dispatch,
    });
  } else {
    showDialog({ mediaType: "audio", result, quasarDialog });
  }
}

export async function generateAndSaveAllAudioWithDialog({
  quasarDialog,
  quasarNotify,
  dispatch,
  dirPath,
  disableNotifyOnGenerate,
}: {
  quasarDialog: QuasarDialog;
  quasarNotify: QuasarNotify;
  dispatch: Dispatch<AllActions>;
  dirPath?: DirPath;
  disableNotifyOnGenerate: boolean;
}): Promise<void> {
  if (!dirPath) {
    const dirResult = await getDirPathWithDialog({
      title: "音声を全て保存",
    });
    if (!dirResult.ok) return;
    dirPath = dirResult.value;
  }

  const result = await withProgress(
    dispatch("GENERATE_AND_SAVE_ALL_AUDIO", {
      dirPath,
      callback: (finishedCount, totalCount) =>
        dispatch("SET_PROGRESS_FROM_COUNT", { finishedCount, totalCount }),
    }),
    dispatch
  );

  // 書き出し成功時の出力先パスを配列に格納
  const successArray = result.flatMap((result) =>
    result.result === "SUCCESS" ? result.path : []
  );

  if (successArray.length === result.length) {
    if (!disableNotifyOnGenerate) {
      // 書き出し成功時に通知をする
      showNotify({
        mediaType: "audio",
        quasarNotify,
        dispatch,
      });
    }
  } else {
    // 書き込みエラーを配列に格納
    const writeErrorArray: Array<ErrorTypeForSaveAllResultDialog> =
      result.flatMap((result) =>
        result.result === "WRITE_ERROR"
          ? { path: result.path ?? "", message: result.errorMessage ?? "" }
          : []
      );

    // エンジンエラーを配列に格納
    const engineErrorArray: Array<ErrorTypeForSaveAllResultDialog> =
      result.flatMap((result) =>
        result.result === "ENGINE_ERROR"
          ? { path: result.path ?? "", message: result.errorMessage ?? "" }
          : []
      );

    quasarDialog({
      component: SaveAllResultDialog,
      componentProps: {
        successArray,
        writeErrorArray,
        engineErrorArray,
      },
    });
  }
}

export async function generateAndConnectAndSaveAudioWithDialog({
  quasarDialog,
  quasarNotify,
  dispatch,
  getters,
  disableNotifyOnGenerate,
}: {
  quasarDialog: QuasarDialog;
  quasarNotify: QuasarNotify;
  dispatch: Dispatch<AllActions>;
  getters: AllGetters;
  disableNotifyOnGenerate: boolean;
}): Promise<void> {
  const defaultName: FileName = `${getters.DEFAULT_PROJECT_FILE_NAME}.wav`;
  let filePath = await getters.FIXED_FILE_PATH(defaultName);
  if (!filePath) {
    const filePathResult = await getFilePathWithDialog({
      defaultName,
      mediaType: "audio",
      title: "音声を全て繋げて保存",
    });
    if (!filePathResult.ok) return;
    filePath = filePathResult.value;
  }

  const result = await withProgress(
    dispatch("GENERATE_AND_CONNECT_AND_SAVE_AUDIO", {
      filePath,
      callback: (finishedCount, totalCount) =>
        dispatch("SET_PROGRESS_FROM_COUNT", { finishedCount, totalCount }),
    }),
    dispatch
  );

  if (result.result === "SUCCESS") {
    if (disableNotifyOnGenerate) return;
    showNotify({
      mediaType: "audio",
      quasarNotify,
      dispatch,
    });
  } else {
    showDialog({ mediaType: "audio", result, quasarDialog });
  }
}

export async function connectAndExportTextWithDialog({
  quasarDialog,
  quasarNotify,
  dispatch,
  getters,
  disableNotifyOnGenerate,
}: {
  quasarDialog: QuasarDialog;
  quasarNotify: QuasarNotify;
  dispatch: Dispatch<AllActions>;
  getters: AllGetters;
  disableNotifyOnGenerate: boolean;
}): Promise<void> {
  const defaultName: FileName = `${getters.DEFAULT_PROJECT_FILE_NAME}.txt`;
  let filePath = await getters.FIXED_FILE_PATH(defaultName);
  if (!filePath) {
    const filePathResult = await getFilePathWithDialog({
      defaultName,
      mediaType: "text",
      title: "文章を全て繋げてテキストファイルに保存",
    });
    if (!filePathResult.ok) return;
    filePath = filePathResult.value;
  }

  const result = await dispatch("CONNECT_AND_EXPORT_TEXT", {
    filePath,
  });

  if (result.result === "SUCCESS") {
    if (disableNotifyOnGenerate) return;
    showNotify({
      mediaType: "text",
      quasarNotify,
      dispatch,
    });
  } else {
    showDialog({ mediaType: "text", result, quasarDialog });
  }
}

async function getDirPathWithDialog(obj: {
  title: string;
}): Promise<Result<DirPath>> {
  const dirPath = await window.electron.showOpenDirectoryDialog(obj);
  if (!dirPath) {
    return failure(new Error("CANCELED"));
  }
  return success(dirPath as DirPath);
}

async function getFilePathWithDialog(obj: {
  defaultName: string;
  title: string;
  mediaType: SaveMediaType;
}): Promise<Result<FilePath>> {
  const filePath = await window.electron.showSaveDialog(obj);
  if (!filePath) {
    return failure(new Error("CANCELED"));
  }
  return success(filePath as FilePath);
}

// 成功時の通知を表示
const showNotify = ({
  mediaType,
  quasarNotify,
  dispatch,
}: {
  mediaType: SaveMediaType;
  quasarNotify: QuasarNotify;
  dispatch: Dispatch<AllActions>;
}): void => {
  quasarNotify({
    message: `${mediaTypeNames[mediaType]}を書き出しました`,
    color: "toast",
    textColor: "toast-display",
    icon: "info",
    timeout: 5000,
    actions: [
      {
        label: "今後この通知をしない",
        textColor: "toast-button-display",
        handler: () => {
          dispatch("SET_CONFIRMED_TIP", {
            confirmedTip: {
              notifyOnGenerate: true,
            },
          });
        },
      },
    ],
  });
};

// 書き出し失敗時のダイアログを表示
const showDialog = ({
  mediaType,
  result,
  quasarDialog,
}: {
  mediaType: SaveMediaType;
  result: SaveResultObject;
  quasarDialog: QuasarDialog;
}) => {
  if (mediaType === "text") {
    // テキスト書き出し時のエラーを出力
    quasarDialog({
      title: "テキストの書き出しに失敗しました。",
      message:
        "書き込みエラーによって失敗しました。空き容量があることや、書き込み権限があることをご確認ください。",
      ok: {
        label: "閉じる",
        flat: true,
        textColor: "secondary",
      },
    });
  } else if (mediaType === "audio") {
    const defaultErrorMessages: Partial<Record<SaveResult, string>> = {
      WRITE_ERROR:
        "何らかの理由で書き出しに失敗しました。ログを参照してください。",
      ENGINE_ERROR:
        "エンジンのエラーによって失敗しました。エンジンの再起動をお試しください。",
      UNKNOWN_ERROR:
        "何らかの理由で書き出しに失敗しました。ログを参照してください。",
    };

    // 音声書き出し時のエラーを出力
    quasarDialog({
      title: "書き出しに失敗しました。",
      message: result.errorMessage ?? defaultErrorMessages[result.result],
      ok: {
        label: "閉じる",
        flat: true,
        textColor: "secondary",
      },
    });
  } else {
    // プロジェクトファイルはここでは扱わない
    throw new Error("予期せぬコードに到達しました");
  }
};
