/**
 * audio系データの生成とキャッシュの管理を行う
 */
import { BRAND } from "zod";
import { createPartialStore } from "./vuex";
import { convertAudioQueryFromEditorToEngine } from "./proxy";
import {
  AudioGeneratorStoreState,
  AudioGeneratorStoreTypes,
  AudioItem,
  EditorAudioQuery,
} from "./type";
import { generateUniqueId } from "./utility";

export type BlobId = string & BRAND<"BlobId">;

export async function generateLabFromAudioQuery({
  query,
  offset,
}: {
  query: EditorAudioQuery;
  offset?: number;
}) {
  const speedScale = query.speedScale;

  let labString = "";
  let timestamp = offset ?? 0;

  labString += timestamp.toFixed() + " ";
  timestamp += (query.prePhonemeLength * 10000000) / speedScale;
  labString += timestamp.toFixed() + " ";
  labString += "pau" + "\n";

  for (const accentPhrase of query.accentPhrases) {
    for (const mora of accentPhrase.moras) {
      if (mora.consonantLength !== undefined && mora.consonant !== undefined) {
        labString += timestamp.toFixed() + " ";
        timestamp += (mora.consonantLength * 10000000) / speedScale;
        labString += timestamp.toFixed() + " ";
        labString += mora.consonant + "\n";
      }
      labString += timestamp.toFixed() + " ";
      timestamp += (mora.vowelLength * 10000000) / speedScale;
      labString += timestamp.toFixed() + " ";
      if (mora.vowel != "N") {
        labString += mora.vowel.toLowerCase() + "\n";
      } else {
        labString += mora.vowel + "\n";
      }
    }
    if (
      accentPhrase.pauseMora !== undefined &&
      accentPhrase.pauseMora !== null
    ) {
      labString += timestamp.toFixed() + " ";
      timestamp += (accentPhrase.pauseMora.vowelLength * 10000000) / speedScale;
      labString += timestamp.toFixed() + " ";
      labString += accentPhrase.pauseMora.vowel + "\n";
    }
  }

  labString += timestamp.toFixed() + " ";
  timestamp += (query.postPhonemeLength * 10000000) / speedScale;
  labString += timestamp.toFixed() + " ";
  labString += "pau" + "\n";

  return labString;
}

export function getAudioGeneratingErrorMessage(e: unknown) {
  // FIXME: GENERATE_AUDIO_BLOB のエラーを変えた場合変更する
  if (e instanceof Error && e.message === "VALID_MORPHING_ERROR") {
    return "モーフィングの設定が無効です。";
  } else {
    window.electron.logError(e);
  }
  return undefined;
}

const audioBlobCache: Map<BlobId, Blob> = new Map();

export const audioGeneratorStoreState: AudioGeneratorStoreState = {
  nowGeneratingBlobIds: new Set(),
};

export const audioGeneratorStore = createPartialStore<AudioGeneratorStoreTypes>(
  {
    SET_AUDIO_BLOB_NOW_GENERATING: {
      mutation(
        state,
        { blobId, nowGenerating }: { blobId: BlobId; nowGenerating: boolean }
      ) {
        if (nowGenerating) {
          state.nowGeneratingBlobIds.add(blobId);
        } else {
          state.nowGeneratingBlobIds.delete(blobId);
        }
      },
    },

    FETCH_ID_AUDIO_BLOB_PAIR: {
      async action(
        { dispatch, commit, state },
        { audioItem }: { audioItem: Readonly<AudioItem> }
      ) {
        audioItem = JSON.parse(JSON.stringify(audioItem)) as AudioItem;
        const audioQuery = audioItem.query;
        if (audioQuery == undefined)
          throw new Error("audioQuery is not defined for audioItem");
        audioQuery.outputSamplingRate =
          state.engineSettings[audioItem.voice.engineId].outputSamplingRate;
        audioQuery.outputStereo = state.savingSetting.outputStereo;

        const blobId = await generateUniqueId<BlobId>([
          audioItem.text,
          audioQuery,
          audioItem.voice,
          audioItem.morphingInfo,
          state.experimentalSetting.enableInterrogativeUpspeak, // このフラグが違うと、同じAudioQueryで違う音声が生成されるので追加
        ]);

        // 音声用意
        let blob = audioBlobCache.get(blobId);
        if (!blob) {
          commit("SET_AUDIO_BLOB_NOW_GENERATING", {
            blobId,
            nowGenerating: true,
          });
          try {
            blob = await dispatch("GENERATE_AUDIO_BLOB", {
              audioItem,
              audioQuery,
            });
            audioBlobCache.set(blobId, blob);
          } finally {
            commit("SET_AUDIO_BLOB_NOW_GENERATING", {
              blobId,
              nowGenerating: false,
            });
          }
        }
        return { blobId, blob };
      },
    },

    GENERATE_AUDIO_BLOB: {
      async action(
        { dispatch, getters, state },
        {
          audioItem,
          audioQuery,
        }: {
          audioItem: Readonly<AudioItem>;
          audioQuery: EditorAudioQuery;
        }
      ) {
        const engineId = audioItem.voice.engineId;
        const speaker = audioItem.voice.styleId;

        const engineAudioQuery = convertAudioQueryFromEditorToEngine(
          audioQuery,
          state.engineManifests[engineId].defaultSamplingRate
        );

        const instance = await dispatch("INSTANTIATE_ENGINE_CONNECTOR", {
          engineId,
        });
        let blob: Blob;
        // FIXME: モーフィングが設定で無効化されていてもモーフィングが行われるので気づけるUIを作成する
        if (audioItem.morphingInfo != undefined) {
          if (!getters.VALID_MORPHING_INFO(audioItem))
            throw new Error("VALID_MORPHING_ERROR"); //FIXME: エラーを変更した場合ハンドリング部分も修正する
          blob = await instance.invoke(
            "synthesisMorphingSynthesisMorphingPost"
          )({
            audioQuery: engineAudioQuery,
            baseSpeaker: speaker,
            targetSpeaker: audioItem.morphingInfo.targetStyleId,
            morphRate: audioItem.morphingInfo.rate,
          });
        } else {
          blob = await instance.invoke("synthesisSynthesisPost")({
            audioQuery: engineAudioQuery,
            speaker,
            enableInterrogativeUpspeak:
              state.experimentalSetting.enableInterrogativeUpspeak,
          });
        }
        return blob;
      },
    },
  }
);
