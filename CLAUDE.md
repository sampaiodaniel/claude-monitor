# Claude Monitor - Development Guidelines

## Versioning

Follow **Semantic Versioning** strictly. Update `version` in `manifest.json` on EVERY commit:

- **Patch** (1.3.**1**): bug fixes, cosmetic adjustments, typos
- **Minor** (1.**4**.0): new features, new UI elements, new settings
- **Major** (**2**.0.0): breaking changes (storage schema changes, incompatible updates)

Never commit without bumping the version. Include a changelog summary in the commit message.

## Project Structure

- Chrome extension (Manifest V3)
- Account detection via `/api/account` (user-level, not org-level)
- Multi-account support: users in the same org are distinguished by user UUID
- Storage keys namespaced per account: `account:{userUuid}:usageLog`, etc.

## Language

- All UI text in Portuguese (pt-BR) with proper accents
- Code comments in English
