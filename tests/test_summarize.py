# tests/test_summarize.py
from backend.services.summarize import summarize_text

SAMPLE = """
Decisions:
- We will cap uploads at 50 MB.
Action Items:
- @shiva to add PDF parsing — due 2025-10-18
- @arul to add progress bar
Notes:
- Keep temperature low.
"""

def test_heuristic_lists_items():
    out = summarize_text(SAMPLE, max_tokens=256, temperature=0.1)
    assert isinstance(out["key_points"], list)
    assert isinstance(out["decisions"], list)
    assert isinstance(out["action_items"], list)
    # should detect at least one decision and one action
    assert any("cap uploads" in s.lower() for s in out["decisions"])
    assert any("@shiva" in s.lower() for s in out["action_items"])
