"""
Render The Board as a self-contained web page from live Supabase odds.

Reuses the_board.py (same query + arithmetic) and emits an HTML page: a summary
strip plus one card per game, best price per side, shopping edge, key-number
flags. Output is artifact-ready (a <title>, a <style>, and body markup -- no
<html>/<head>/<body> wrappers, which the Artifact host adds).

    python analysis/board_web.py                       # week 1 -> board.html
    python analysis/board_web.py --week 2 --out wk2.html
"""
import argparse
import html
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from the_board import build, fetch_week, fmt_odds, load_env  # noqa: E402

ET = ZoneInfo("America/New_York")  # NFL runs on Eastern; DST handled by the tz db.


def _et(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(ET)


def fmt_kick(iso):
    dt = _et(iso)
    h = dt.strftime("%I").lstrip("0")
    return f"{dt.strftime('%a %b')} {dt.day}, {h}:{dt.strftime('%M %p')} ET"


def fmt_snapshot(iso):
    dt = _et(iso)
    h = dt.strftime("%I").lstrip("0")
    return f"{dt.strftime('%b')} {dt.day}, {dt.year} · {h}:{dt.strftime('%M %p')} ET"


def esc(s):
    return html.escape(str(s))


def line_html(team, price, books, best=False):
    cls = "line best" if best else "line"
    if len(books) == 1:
        book_html = f'<span class="book">{esc(books[0])}</span>'
    else:
        book_html = (f'<span class="book tie" title="{esc(", ".join(books))}">'
                     f'×{len(books)} books</span>')
    return (f'<div class="{cls}"><span class="team">{esc(team)}</span>'
            f'<span class="odds">{esc(fmt_odds(price))}</span>'
            f'{book_html}</div>')


def market_html(label, left, right, extra=""):
    return (f'<div class="mkt"><span class="mkt__label">{label}</span>'
            f'<div class="lines">{left}{right}</div>'
            f'<div class="mkt__note">{extra}</div></div>')


def game_card(g):
    ml = g["ml"]
    # moneyline: highest edge side gets the "best" emphasis
    ml_items = list(ml.items())
    best_side = max(ml_items, key=lambda kv: kv[1][2])[0] if ml_items else None
    ml_lines = ""
    ml_edge = 0.0
    for side, (price, books, edge, _n) in ml_items:
        ml_lines += line_html(side, price, books, best=(side == best_side))
        ml_edge = max(ml_edge, edge)
    ml_note = f'<span class="edge">shop&nbsp;+{ml_edge:.1f}%</span>'

    s = g["spread"]
    spr_html = ""
    is_key = False
    if s[g["home"]] and s[g["away"]]:
        hp, hpr, hb = s[g["home"]]
        ap, apr, ab = s[g["away"]]
        left = line_html(f"{g['home']} {hp:+g}", hpr, hb)
        right = line_html(f"{g['away']} {ap:+g}", apr, ab)
        note = ""
        if s["key"]:
            is_key = True
            num, cost = s["key"]
            note = f'<span class="keytag">key {int(num)} · ½pt ≈ {cost:.0f}%</span>'
        spr_html = market_html("Spread", left, right, note)

    t = g["total"]
    tot_html = ""
    if t["Over"] and t["Under"]:
        op, opr, ob = t["Over"]
        up, upr, ub = t["Under"]
        left = line_html(f"O {op:g}", opr, ob)
        right = line_html(f"U {up:g}", upr, ub)
        tot_html = market_html("Total", left, right, "")

    card_cls = "game key" if is_key else "game"
    badge = ('<span class="badge">KEY NUMBER</span>' if is_key else "")
    return (f'<article class="{card_cls}">'
            f'<header class="game__head"><span class="matchup">{esc(g["away"])}'
            f'<span class="at">@</span>{esc(g["home"])}</span>'
            f'<time class="kick">{esc(fmt_kick(g["commence"]))}</time>{badge}</header>'
            f'<div class="markets">'
            f'{market_html("Moneyline", ml_lines, "", ml_note)}'
            f'{spr_html}{tot_html}</div></article>')


def page(board, week, season):
    snap = board[0]["snapshot"] if board else ""
    edges = []
    key_games = 0
    for g in board:
        edges += [e for _, (_, _, e, _) in g["ml"].items()]
        if g["spread"].get("key"):
            key_games += 1
    avg_edge = sum(edges) / len(edges) if edges else 0

    cards = "\n".join(game_card(g) for g in board)
    stat = (lambda v, l: f'<div class="stat"><span class="stat__v">{v}</span>'
            f'<span class="stat__l">{l}</span></div>')

    return f"""<title>Value Finder · Week {week} {season}</title>
<style>{CSS}</style>
<main class="wrap">
  <header class="masthead">
    <div class="brand">
      <span class="brand__mark">VALUE&nbsp;FINDER</span>
      <span class="brand__sub">Line shopping &amp; key numbers · Week {week}, {season}</span>
    </div>
    <div class="asof">lines as of<br><b>{esc(fmt_snapshot(snap)) if snap else 'n/a'}</b></div>
  </header>

  <section class="stats" aria-label="summary">
    {stat(f'+{avg_edge:.2f}%', 'avg shopping edge / side')}
    {stat(key_games, 'games on a key number')}
    {stat(10, 'books compared')}
    {stat(len(board), 'games')}
  </section>

  <section class="grid">
    {cards}
  </section>

  <footer class="foot">
    <p><b>No model. No pick.</b> Value Finder shows only the best available number
    across books and where a half-point sits on a key number — arithmetic, not
    prediction. Prices move; this is a single snapshot, timestamped above.</p>
  </footer>
</main>"""


CSS = """
:root{
  --bg:#eef1f4; --surface:#ffffff; --surface-2:#f6f8fa;
  --ink:#161b22; --muted:#5c6672; --line:#dfe4ea;
  --accent:#0f6f68; --accent-soft:#e2f0ee;
  --key:#b04521; --key-soft:#f7e7df;
  --font-sans:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --font-mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#0e1116; --surface:#161b22; --surface-2:#1b212a;
  --ink:#e8ecf1; --muted:#8b95a3; --line:#252c36;
  --accent:#43b3aa; --accent-soft:#12312e;
  --key:#e2865a; --key-soft:#2c1c14;
}}
:root[data-theme="dark"]{
  --bg:#0e1116; --surface:#161b22; --surface-2:#1b212a;
  --ink:#e8ecf1; --muted:#8b95a3; --line:#252c36;
  --accent:#43b3aa; --accent-soft:#12312e;
  --key:#e2865a; --key-soft:#2c1c14;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font-family:var(--font-sans);line-height:1.5;
  -webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
.wrap{max-width:1120px;margin:0 auto;padding:clamp(20px,4vw,44px)}
.masthead{display:flex;justify-content:space-between;align-items:flex-end;
  gap:24px;flex-wrap:wrap;border-bottom:2px solid var(--ink);padding-bottom:18px}
.brand__mark{display:block;font-weight:800;letter-spacing:.14em;
  font-size:clamp(26px,5vw,40px)}
.brand__sub{display:block;color:var(--muted);font-size:14px;margin-top:4px;
  letter-spacing:.01em}
.asof{text-align:right;color:var(--muted);font-size:12px;
  text-transform:uppercase;letter-spacing:.08em;line-height:1.7}
.asof b{color:var(--ink);font-family:var(--font-mono);font-size:13px;
  letter-spacing:0;text-transform:none}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:22px 0 28px}
.stat{background:var(--surface);border:1px solid var(--line);border-radius:10px;
  padding:16px 18px;display:flex;flex-direction:column;gap:4px}
.stat__v{font-family:var(--font-mono);font-size:clamp(20px,3vw,26px);
  font-weight:600;color:var(--accent)}
.stat__l{font-size:11.5px;color:var(--muted);text-transform:uppercase;
  letter-spacing:.07em}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px}
.game{background:var(--surface);border:1px solid var(--line);border-radius:12px;
  padding:16px 18px;position:relative;overflow:hidden}
.game.key{border-color:color-mix(in srgb,var(--key) 45%,var(--line))}
.game.key::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;
  background:var(--key)}
.game__head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;
  padding-bottom:12px;margin-bottom:8px;border-bottom:1px solid var(--line)}
.matchup{font-weight:700;font-size:17px;letter-spacing:.01em}
.matchup .at{color:var(--muted);font-weight:400;margin:0 7px}
.kick{color:var(--muted);font-size:12px;font-family:var(--font-mono)}
.badge{margin-left:auto;background:var(--key-soft);color:var(--key);
  font-size:10px;font-weight:700;letter-spacing:.08em;padding:3px 8px;
  border-radius:20px;text-transform:uppercase;white-space:nowrap}
.markets{display:flex;flex-direction:column;gap:2px}
.mkt{display:grid;grid-template-columns:64px 1fr auto;align-items:center;
  gap:10px;padding:7px 0}
.mkt+.mkt{border-top:1px solid var(--surface-2)}
.mkt__label{font-size:10.5px;color:var(--muted);text-transform:uppercase;
  letter-spacing:.07em;font-weight:600}
.lines{display:flex;gap:8px;flex-wrap:wrap}
.line{display:inline-flex;align-items:baseline;gap:6px;padding:3px 8px;
  border-radius:7px;background:var(--surface-2)}
.line.best{background:var(--accent-soft);
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 35%,transparent)}
.line .team{font-size:12.5px;font-weight:600}
.line .odds{font-family:var(--font-mono);font-size:13px;font-weight:600}
.line.best .odds{color:var(--accent)}
.line .book{font-size:10.5px;color:var(--muted);font-family:var(--font-mono)}
.line .book.tie{cursor:help;border-bottom:1px dotted var(--muted)}
.mkt__note{text-align:right;min-width:0}
.edge{font-family:var(--font-mono);font-size:12px;color:var(--accent);
  font-weight:600;white-space:nowrap}
.keytag{font-size:10.5px;color:var(--key);font-weight:600;white-space:nowrap;
  font-family:var(--font-mono)}
.foot{margin-top:30px;padding-top:18px;border-top:1px solid var(--line)}
.foot p{max-width:70ch;color:var(--muted);font-size:13px;margin:0}
.foot b{color:var(--ink)}
@media (max-width:640px){
  .stats{grid-template-columns:repeat(2,1fr)}
  .mkt{grid-template-columns:56px 1fr;grid-template-rows:auto auto}
  .mkt__note{grid-column:2;text-align:left}
}
"""


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--week", type=int, default=1)
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--out", default="board.html")
    args = ap.parse_args(argv)

    env = load_env()
    rows = fetch_week(env, args.week, args.season)
    board = build(rows)
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(page(board, args.week, args.season))
    print(f"wrote {args.out} ({len(board)} games)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
