# Learn Pace Mobile (`apps/mobile`)

Expo (Dev Client) + React Native application shell for Android ARM64 (M1 S1).

- UI only dispatches commands to `@learn-pace/app-host` and renders projections.
- Business rules live in `@learn-pace/domain` (pure TypeScript, no RN/Pi imports).
- Agent Runtime adapter lives in `@learn-pace/runtime` (latest `@earendil-works/pi-durable`, reusing authorized Cherry Studio Mobile RN/Hermes adaptation).
