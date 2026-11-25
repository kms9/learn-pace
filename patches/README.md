# Pi 1.6.0 on Android

The mobile workbench uses Pi Durable's in-memory Harness and Pi AI's OpenAI Completions transport. Expo owns the streaming fetch transport and the cryptographic random source. The application owns credential lookup through SecureStore. Cherry Studio Mobile at `14a0224` informed the Metro resolver and patch triage.

| Cherry 1.5.0 change | Learn Pace 1.6.0 disposition |
| --- | --- |
| Pi AI native auth context | Retained as a 24-line patch. Metro rejects the upstream computed dynamic import of Node filesystem helpers. The browser-map override selects the native context while Node keeps the upstream implementation. |
| Pi AI OAuth flows, native OAuth exports and environment key discovery | Outside the bundle's DeepSeek path. The gateway credential is passed explicitly. |
| Pi AI other provider streams, Mistral block arrays, Gemini thought signatures | Provider-specific changes outside the selected API and model. |
| Pi AI provider diagnostics and retry | 1.6.0 preserves HTTP error text and causes. The adapter emits a bounded failure and exposes only a numeric HTTP status when available. |
| Pi Durable and Chord runtime | Pi Durable and Chord passed the physical phone’s tool registration and cancellation using the unpatched 1.6.0 packages. The 1.5.0 Chord array descriptor change was unnecessary on this Hermes path. |
| Pi Durable Code Mode output and tool search | Those entry points are unused. `Intl.Segmenter` still appears in the optional search module. |
| Pi Durable compaction result hooks | The isolated Harness disables compaction. The SQLite learning database is the authority for the practice state. |
| Pi Code Mode native sandbox and Metro/Metro Runtime Worklets | Worklets and the Code Mode sandbox are outside the app. |

The Release Metro source map contained no SDK modules from Anthropic, Google GenAI or AWS Bedrock.
