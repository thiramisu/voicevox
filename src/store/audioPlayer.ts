import { createPartialStore } from "./vuex";
import { AudioPlayerStoreState, AudioPlayerStoreTypes } from "./type";
import { BlobId } from "./audioGenerator";

export const audioPlayerStoreState: AudioPlayerStoreState = {
  nowPlayingBlobIds: new Set(),
  nowPlayingContinuouslyBlobId: undefined,
};

// BlobId 毎に一つ
const audioElements: Map<BlobId, HTMLAudioElement> = new Map();

export const audioPlayerStore = createPartialStore<AudioPlayerStoreTypes>({
  AUDIO_PLAYING_TIME: {
    getter: (state) => (blobId: BlobId) =>
      !state.nowPlayingBlobIds.has(blobId)
        ? undefined
        : audioElements.get(blobId)?.currentTime ?? undefined,
  },

  NOW_PLAYING_CONTINUOUSLY: {
    getter(state) {
      return state.nowPlayingContinuouslyBlobId !== undefined;
    },
  },

  LOAD_AUDIO_BLOB: {
    mutation(_, { blobId, blob }: { blobId: BlobId; blob: Blob }) {
      const audioElement = new Audio();
      audioElement.pause();
      audioElement.src = URL.createObjectURL(blob);
      audioElements.set(blobId, audioElement);
    },
    action({ commit }, { blobId, blob }: { blobId: BlobId; blob: Blob }) {
      if (audioElements.has(blobId)) {
        return;
      }
      commit("LOAD_AUDIO_BLOB", { blobId, blob });
    },
  },

  UNLOAD_AUDIO_BLOB: {
    action({ dispatch }, { blobId }: { blobId?: BlobId }) {
      if (blobId === undefined || !audioElements.has(blobId)) {
        return;
      }
      dispatch("STOP_AUDIO_BLOB", { blobId });
      audioElements.delete(blobId);
    },
  },

  SET_AUDIO_BLOB_NOW_PLAYING: {
    mutation(
      state,
      { blobId, nowPlaying }: { blobId: BlobId; nowPlaying: boolean }
    ) {
      if (nowPlaying) {
        state.nowPlayingBlobIds.add(blobId);
      } else {
        state.nowPlayingBlobIds.delete(blobId);
      }
    },
  },

  PLAY_AUDIO_BLOB: {
    async action(
      { state, commit },
      { blobId, offset }: { blobId: BlobId; offset?: number }
    ) {
      const audioElem = audioElements.get(blobId);
      if (!audioElem)
        throw new Error(
          "音声の読み込み前に再生されようとしました。先に LOAD_AUDIO_BLOB を行ってください。"
        );

      // 小さい値が切り捨てられることでフォーカスされるアクセントフレーズが一瞬元に戻るので、
      // 再生に影響のない程度かつ切り捨てられない値を加算する
      if (offset !== undefined) {
        audioElem.currentTime = offset + 10e-6;
      }

      // 一部ブラウザではsetSinkIdが実装されていないので、その環境では無視する
      if (audioElem.setSinkId) {
        audioElem
          .setSinkId(state.savingSetting.audioOutputDevice)
          .catch((err) => {
            const stop = () => {
              audioElem.pause();
              audioElem.removeEventListener("canplay", stop);
            };
            audioElem.addEventListener("canplay", stop);
            window.electron.showMessageDialog({
              type: "error",
              title: "エラー",
              message: "再生デバイスが見つかりません",
            });
            throw new Error(err);
          });
      }

      // 再生終了時にresolveされるPromiseを返す
      const played = async () => {
        commit("SET_AUDIO_BLOB_NOW_PLAYING", { blobId, nowPlaying: true });
      };
      audioElem.addEventListener("play", played);

      let paused: () => void;
      const audioPlayPromise = new Promise<boolean>((resolve) => {
        paused = () => {
          resolve(audioElem.ended);
        };
        audioElem.addEventListener("pause", paused);
      }).finally(async () => {
        audioElem.removeEventListener("play", played);
        audioElem.removeEventListener("pause", paused);
        if (blobId) {
          commit("SET_AUDIO_BLOB_NOW_PLAYING", { blobId, nowPlaying: false });
        }
      });

      audioElem.play();

      return audioPlayPromise;
    },
  },

  STOP_AUDIO_BLOB: {
    action({ commit }, { blobId }: { blobId: BlobId }) {
      const audioElem = audioElements.get(blobId);
      if (audioElem === undefined) throw new Error("audioElem === undefined");
      audioElem.pause();
      commit("SET_AUDIO_BLOB_NOW_PLAYING", { blobId, nowPlaying: false });
    },
  },

  PLAY_AUDIO_CONTINUOUSLY: {
    mutation(state, { blobId }: { blobId: BlobId | undefined }) {
      state.nowPlayingContinuouslyBlobId = blobId;
    },
    async action({ commit, dispatch }, { blobIds }) {
      try {
        for await (const blobId of blobIds) {
          commit("PLAY_AUDIO_CONTINUOUSLY", { blobId });
          const isEnded = await dispatch("PLAY_AUDIO_BLOB", {
            blobId,
            offset: 0,
          });
          if (!isEnded) {
            break;
          }
        }
      } finally {
        commit("PLAY_AUDIO_CONTINUOUSLY", { blobId: undefined });
      }
    },
  },

  STOP_CONTINUOUSLY_AUDIO: {
    mutation(state) {
      state.nowPlayingContinuouslyBlobId = undefined;
    },
    action({ state, commit, dispatch }) {
      commit("STOP_CONTINUOUSLY_AUDIO");
      if (state.nowPlayingContinuouslyBlobId !== undefined) {
        dispatch("STOP_AUDIO_BLOB", {
          blobId: state.nowPlayingContinuouslyBlobId,
        });
      }
    },
  },
});
