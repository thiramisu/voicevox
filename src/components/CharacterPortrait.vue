<template>
  <div class="character-portrait-wrapper" @click="talk">
    <span class="character-name">{{ characterName }}</span>
    <span v-if="isMultipleEngine" class="character-engine-name">{{
      engineName
    }}</span>
    <div class="relative character-portrait">
      <img :src="portraitPath" :alt="characterName" />
      <div
        v-if="nowSpeechPlaying"
        class="speech-bubble text-center absolute full-width"
      >
        {{ speechBubble }}
      </div>
    </div>
    <div v-if="isInitializingSpeaker" class="loading">
      <q-spinner color="primary" size="5rem" :thickness="4" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuasar } from "quasar";
import { useStore } from "@/store";
import { AudioItem } from "@/store/type";
import { AudioKey, EngineId, SpeakerId } from "@/type/preload";

const store = useStore();

const characterInfo = computed(() => {
  const activeAudioKey: AudioKey | undefined = store.getters.ACTIVE_AUDIO_KEY;
  const audioItem = activeAudioKey
    ? store.state.audioItems[activeAudioKey]
    : undefined;

  const engineId = audioItem?.voice.engineId;
  const styleId = audioItem?.voice.styleId;

  if (
    engineId === undefined ||
    styleId === undefined ||
    !store.state.engineIds.some((id) => id === engineId)
  )
    return undefined;

  return store.getters.CHARACTER_INFO(engineId, styleId);
});

const styleInfo = computed(() => {
  const activeAudioKey = store.getters.ACTIVE_AUDIO_KEY;

  const audioItem = activeAudioKey
    ? store.state.audioItems[activeAudioKey]
    : undefined;

  const styleId = audioItem?.voice.styleId;
  const style = characterInfo.value?.metas.styles.find(
    (style) => style.styleId === styleId
  );
  return style;
});

const characterName = computed(() => {
  return styleInfo.value?.styleName
    ? `${characterInfo.value?.metas.speakerName} (${styleInfo.value?.styleName})`
    : characterInfo.value?.metas.speakerName;
});

const engineName = computed(() => {
  const activeAudioKey = store.getters.ACTIVE_AUDIO_KEY;
  const audioItem = activeAudioKey
    ? store.state.audioItems[activeAudioKey]
    : undefined;
  const engineId = audioItem?.voice.engineId ?? store.state.engineIds[0];
  const engineManifest = store.state.engineManifests[engineId];
  const engineInfo = store.state.engineInfos[engineId];
  return engineManifest ? engineManifest.brandName : engineInfo.name;
});

const portraitPath = computed(
  () => styleInfo.value?.portraitPath || characterInfo.value?.portraitPath
);

const isInitializingSpeaker = computed(() => {
  const activeAudioKey = store.getters.ACTIVE_AUDIO_KEY;
  return store.state.audioKeyInitializingSpeaker === activeAudioKey;
});

const isMultipleEngine = computed(() => store.state.engineIds.length > 1);

const $q = useQuasar();
const speechBubble = ref<string>();
const nowSpeechGenerating = ref(false);
const nowSpeechPlaying = ref(false);
let talkData: Record<EngineId, Record<SpeakerId, AudioItem[]>> | undefined =
  undefined;
const initTalkData = async () => {
  talkData = {};

  const { audioItems, audioKeys } = await store.dispatch("PARSE_PROJECT_JSON", {
    text: await store.dispatch("GET_SPEECH_BUBBLE_PROJECT_FILE"),
    errorMessagePrefix: "Speech bubble data is invalid.",
  });
  if (!(audioKeys instanceof Array)) {
    return;
  }
  for (const audioKey of audioKeys) {
    const audioItem = audioItems[audioKey];
    if (!audioItem?.voice) {
      continue;
    }
    const { engineId, speakerId } = audioItem.voice;
    if (talkData[engineId] === undefined) {
      talkData[engineId] = {};
    }
    if (talkData[engineId][speakerId] === undefined) {
      talkData[engineId][speakerId] = [];
    }
    talkData[engineId][speakerId].push(audioItem);
  }
};
const getRamdomSpeechAudioItem = () => {
  const audioKey = store.getters.ACTIVE_AUDIO_KEY;
  if (audioKey === undefined) {
    return undefined;
  }
  const voice = store.state.audioItems[audioKey].voice;
  const talks = talkData?.[voice.engineId]?.[voice.speakerId];
  if (talks === undefined || talks.length === 0) {
    return undefined;
  }
  const audioItem = talks[Math.floor(Math.random() * talks.length)];
  audioItem.voice.styleId = voice.styleId;
  return audioItem;
};
const audioElem = new Audio();
audioElem.pause();
const talk = async () => {
  if (talkData === undefined) {
    await initTalkData();
  }
  if (nowSpeechGenerating.value) {
    console.log("生成中です。");
    return;
  }
  const audioItem = getRamdomSpeechAudioItem();
  if (audioItem === undefined) {
    console.log("対応データが見つかりませんでした。");
    return;
  }

  nowSpeechGenerating.value = true;

  let blob = await store.dispatch("GET_AUDIO_CACHE_FROM_AUDIO_ITEM", {
    audioItem,
  });
  if (!blob) {
    try {
      blob = await store.dispatch("GENERATE_AUDIO_FROM_AUDIO_ITEM", {
        audioItem,
      });
    } catch (e) {
      window.electron.logError(e);
      nowSpeechGenerating.value = false;
      $q.dialog({
        title: "生成に失敗しました",
        message: "エンジンの再起動をお試しください。",
        ok: {
          label: "閉じる",
          flat: true,
          textColor: "display",
        },
      });
      return;
    }
  }
  speechBubble.value = audioItem.text;
  nowSpeechGenerating.value = false;
  nowSpeechPlaying.value = true;
  await store.dispatch("PLAY_AUDIO_BLOB_WITHOUT_UI_LOCK", {
    audioElem,
    audioBlob: blob,
  });
  nowSpeechPlaying.value = false;
};
</script>

<style scoped lang="scss">
@use '@/styles/colors' as colors;

.character-name {
  position: absolute;
  padding: 1px 24px 1px 8px;
  background-image: linear-gradient(
    90deg,
    rgba(colors.$background-rgb, 0.5) 0%,
    rgba(colors.$background-rgb, 0.5) 75%,
    transparent 100%
  );
  overflow-wrap: anywhere;
}

.character-engine-name {
  position: absolute;
  padding: 1px 24px 1px 8px;
  background-image: linear-gradient(
    90deg,
    rgba(colors.$background-rgb, 0.5) 0%,
    rgba(colors.$background-rgb, 0.5) 75%,
    transparent 100%
  );
  bottom: 0;
  overflow-wrap: anywhere;
}

.character-portrait-wrapper {
  display: grid;
  justify-content: center;
  width: 100%;
  height: 100%;
  overflow: hidden;
  .character-portrait {
    margin: auto;
  }
  .loading {
    position: absolute;
    width: 100%;
    height: 100%;
    background-color: rgba(colors.$background-rgb, 0.3);
    display: grid;
    justify-content: center;
    align-content: center;
  }
}

.speech-bubble {
  background-color: rgba(colors.$background-rgb, 0.7);
  font-size: 1.2rem;
  left: 0;
  padding: 0 1rem;
  text-shadow: 0 0 1px colors.$background;
  top: calc(50% + 30px);
}
</style>
