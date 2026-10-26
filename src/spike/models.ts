export type Device = 'webgpu' | 'wasm';

export interface GenModel {
  id: string;
  label: string;
  licence: string;
  /** Default weights per device and their download size in MB. */
  dtype: Record<Device, { dtype: string; sizeMB: number }>;
  /** Extra chat-template variables. */
  template?: Record<string, unknown>;
}

// q4f16 needs WebGPU's shader-f16; on WASM the smaller of q4 and int8 is used.
export const GEN_MODELS: GenModel[] = [
  {
    id: 'HuggingFaceTB/SmolLM2-360M-Instruct',
    label: 'SmolLM2 360M',
    licence: 'Apache-2.0',
    dtype: { webgpu: { dtype: 'q4f16', sizeMB: 273 }, wasm: { dtype: 'q8', sizeMB: 365 } },
  },
  {
    id: 'onnx-community/LFM2-350M-ONNX',
    label: 'LFM2 350M',
    licence: 'LFM Open License (not OSI)',
    dtype: { webgpu: { dtype: 'q4f16', sizeMB: 255 }, wasm: { dtype: 'q4', sizeMB: 294 } },
  },
  {
    id: 'onnx-community/gemma-3-270m-it-ONNX',
    label: 'Gemma 3 270M',
    licence: 'Gemma Terms of Use (not OSI)',
    dtype: { webgpu: { dtype: 'q4f16', sizeMB: 273 }, wasm: { dtype: 'q4', sizeMB: 323 } },
  },
  {
    id: 'onnx-community/Qwen2.5-0.5B-Instruct',
    label: 'Qwen2.5 0.5B',
    licence: 'Apache-2.0',
    dtype: { webgpu: { dtype: 'q4f16', sizeMB: 483 }, wasm: { dtype: 'q8', sizeMB: 512 } },
  },
  {
    id: 'onnx-community/Qwen3-0.6B-ONNX',
    label: 'Qwen3 0.6B',
    licence: 'Apache-2.0',
    dtype: { webgpu: { dtype: 'q4f16', sizeMB: 570 }, wasm: { dtype: 'q8', sizeMB: 618 } },
    template: { enable_thinking: false },
  },
  // Larger models for capable devices (SPEC §11.5). Big downloads: try on Wi-Fi.
  {
    id: 'onnx-community/gemma-3-1b-it-ONNX',
    label: 'Gemma 3 1B (large)',
    licence: 'Gemma Terms of Use (not OSI)',
    dtype: { webgpu: { dtype: 'q4f16', sizeMB: 764 }, wasm: { dtype: 'q4', sizeMB: 859 } },
  },
  {
    id: 'onnx-community/Llama-3.2-1B-Instruct-ONNX',
    label: 'Llama 3.2 1B (large)',
    licence: 'Llama 3.2 Community License (not OSI)',
    dtype: { webgpu: { dtype: 'q4f16', sizeMB: 1090 }, wasm: { dtype: 'q8', sizeMB: 1237 } },
  },
  {
    id: 'onnx-community/Qwen3-1.7B-ONNX',
    label: 'Qwen3 1.7B (large)',
    licence: 'Apache-2.0',
    dtype: { webgpu: { dtype: 'q4f16', sizeMB: 1426 }, wasm: { dtype: 'q8', sizeMB: 1742 } },
    template: { enable_thinking: false },
  },
];

/** Questions for the generation runs. The last two are not in the docs. */
export const GEN_QUESTIONS = [
  'How do I add deskpal to my site?',
  'Can I use my own character?',
  'Does anything I type leave my computer?',
  'What CSP does it need?',
  'Can it work without any AI model?',
  'How do I reset my password?',
  "What's the capital of France?",
];

/** Retrieval eval: paraphrased questions and the chunk that answers each. */
export const EVAL_QUESTIONS: { q: string; expect: string }[] = [
  { q: 'How do I put the assistant on my website?', expect: '/docs/getting-started.md#add-deskpal-to-your-site' },
  { q: 'Do I need to regenerate anything after editing my documentation?', expect: '/docs/getting-started.md#rebuilding-the-index' },
  { q: 'Can I import it in a webpack project?', expect: '/docs/getting-started.md#using-npm-and-a-bundler' },
  { q: 'How can I stop it from starting by itself?', expect: '/docs/configuration.md' },
  { q: 'Can it start in the top left instead?', expect: '/docs/configuration.md#options' },
  { q: 'Will it remember where I dragged it?', expect: '/docs/configuration.md#remembered-settings' },
  { q: 'Can I point it at my local llama server?', expect: '/docs/models.md#ollama-llamacpp-and-other-openai-compatible-servers' },
  { q: 'Is it OK to paste my OpenAI key into the settings?', expect: '/docs/models.md#ollama-llamacpp-and-other-openai-compatible-servers' },
  { q: 'Does it work with no AI model at all?', expect: '/docs/models.md#retrieval-only' },
  { q: 'Is my typing sent off to some server?', expect: '/docs/security.md#privacy' },
  { q: 'What headers does my security policy need?', expect: '/docs/security.md#content-security-policy' },
  { q: 'How do I swap the mascot for my own drawing?', expect: '/docs/skins.md#manifest-format' },
  { q: 'Which moves must a custom character support?', expect: '/docs/skins.md#required-animations' },
];
