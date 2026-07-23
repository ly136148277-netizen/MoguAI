# Public knowledge distillation (legal path)

Teacher = **your** OpenAI/Anthropic API.
Seeds = **public** HumanEval / SWE-bench Lite only.
No Cursor/Trae private suites.

```bash
cd benchmarks/distill
python -m venv .venv
# Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env   # fill keys if you want real teacher calls

python convert_seed.py --seed-dataset humaneval --limit 5
python run_distill.py --convert-first --seed-dataset humaneval --limit 2 --epochs 1
```

Without API keys, teacher falls back to mock text (still runs the student loop on tiny GPT-2).
