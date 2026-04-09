# daily-ai-code

This project generates one coding lesson per day, writes it into `content/`, and lets GitHub Actions commit the result automatically.

## What it does

- Generates a problem-solving lesson with a title, problem statement, solution code, explanation, and key takeaways
- Prefers AI providers when keys are available
- Falls back to a built-in lesson so the daily automation still succeeds if an API call fails
- Stores lessons in dated markdown files under `content/<year>/`

## Local usage

1. Copy `.env.example` to `.env`
2. Add `HF_TOKEN` for Hugging Face, or `GEMINI_API_KEY` as an alternate provider
3. Run `npm install`
4. Run `npm run generate`

If you want to test the project without calling an API, run:

```powershell
$env:FORCE_FALLBACK='1'
npm run generate
```

## GitHub Actions setup

Add one or more of these repository secrets:

- `HF_TOKEN`
- `HUGGING_FACE_TOKEN`
- `GEMINI_API_KEY`
- `GOOGLE_API_KEY`

For Hugging Face, the script uses the router chat-completions API and defaults plain model names to the `hf-inference` route automatically. If the token or model is rejected, the script falls back to a built-in lesson instead of failing the daily run.

The workflow runs daily at `18:35 UTC`, which is `00:05` in `Asia/Kolkata`.

## Notes

- The repo currently has a local Git safe-directory warning on this machine. If local Git commands fail, run:

```powershell
git config --global --add safe.directory C:/Users/gthar/OneDrive/Dokumen/projects/daily-ai-code
```

- `.env` should stay uncommitted. If a real token has already been committed, rotate it in the provider dashboard.
