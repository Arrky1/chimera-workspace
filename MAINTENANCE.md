# Chimera Maintenance Schedule

## Bi-weekly Update Checklist (Every 2 Weeks)

### AI Models Check
- [ ] OpenAI: Check for new GPT/o-series models at https://platform.openai.com/docs/models
- [ ] Anthropic: Check for new Claude models at https://docs.anthropic.com/en/docs/models
- [ ] Google: Check for new Gemini models at https://ai.google.dev/models
- [ ] xAI: Check for new Grok models at https://docs.x.ai/docs/models
- [ ] DeepSeek: Check for new models at https://api-docs.deepseek.com
- [ ] Alibaba: Check for new Qwen models at https://help.aliyun.com/zh/model-studio/

### Dependencies Check
```bash
# Check for outdated packages
npm outdated

# Update packages
npm update

# Check for security vulnerabilities
npm audit
```

### API Changes
- [ ] Review OpenAI API changelog
- [ ] Review Anthropic API changelog
- [ ] Review Google AI API changelog
- [ ] Review xAI API changelog
- [ ] Review DeepSeek API changelog

### Benchmarks Review
- [ ] Check LMArena leaderboard: https://lmarena.ai/
- [ ] Check Artificial Analysis: https://artificialanalysis.ai/
- [ ] Update model strengths if rankings changed significantly

## Last Updated
- **Date:** January 26, 2026
- **Models Version:** 14 models from 6 providers
- **Next Check:** February 9, 2026

## Update History

### January 26, 2026
- Added GPT-5.2, GPT-5.2 Pro
- Added o3, o4-mini
- Updated to Claude Opus 4.5, Sonnet 4.5
- Added Gemini 3 Pro, 3 Flash, 2.5 Deep Think
- Added Grok 4.1, 4.1 Fast
- Added DeepSeek R1

## Quick Commands

```bash
# Update models file
code src/lib/models.ts

# Test all providers
npm run test:models

# Deploy to Railway
git push origin main
```

## Contact
For model updates or issues, check:
- GitHub Issues: https://github.com/Arrky1/chimera/issues
- AI News: https://www.aimodels.fyi/
