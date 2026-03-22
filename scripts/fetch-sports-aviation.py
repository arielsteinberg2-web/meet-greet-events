"""
fetch-sports-aviation.py
Fetches all tweets from @SportsAviation using the X/Twitter API v2
and saves them to sports-aviation-flights.txt in the project root.

Setup (one time):
  1. Go to https://developer.twitter.com/en/portal/dashboard
  2. Create a free app → grab the "Bearer Token" (read-only, no login needed)
  3. Run:  BEARER_TOKEN=your_token python scripts/fetch-sports-aviation.py
     Or set BEARER_TOKEN in a .env file next to this script.

Free Basic tier: 1 request / 15 min, up to 100 tweets per call.
The script auto-paginates and respects rate limits.
"""

import os, sys, time, json, re, datetime
import urllib.request, urllib.error

# ── CONFIG ────────────────────────────────────────────────────────────────────
ACCOUNT      = 'SportsAviation'
OUTPUT_FILE  = os.path.join(os.path.dirname(__file__), '..', 'sports-aviation-flights.txt')
MAX_TWEETS   = 3200   # X API max lookback for a user timeline
BEARER_TOKEN = os.environ.get('BEARER_TOKEN', '')

# ── AUTH ──────────────────────────────────────────────────────────────────────
if not BEARER_TOKEN:
    # Try loading from .env file in project root
    env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
    if os.path.exists(env_path):
        for line in open(env_path):
            if line.startswith('BEARER_TOKEN='):
                BEARER_TOKEN = line.strip().split('=', 1)[1].strip('"\'')
    if not BEARER_TOKEN:
        print("ERROR: Set BEARER_TOKEN environment variable or add it to .env")
        print("  Get a free token at https://developer.twitter.com/en/portal/dashboard")
        sys.exit(1)

HEADERS = {'Authorization': f'Bearer {BEARER_TOKEN}'}

def api_get(url):
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        if e.code == 429:
            reset = int(e.headers.get('x-rate-limit-reset', time.time() + 900))
            wait  = max(reset - time.time(), 10) + 5
            print(f"  Rate limited — waiting {int(wait)}s …")
            time.sleep(wait)
            return api_get(url)
        raise

# ── LOOKUP USER ID ────────────────────────────────────────────────────────────
print(f"Looking up @{ACCOUNT} …")
data = api_get(f'https://api.twitter.com/2/users/by/username/{ACCOUNT}')
user_id = data['data']['id']
print(f"  User ID: {user_id}")

# ── FETCH TWEETS ──────────────────────────────────────────────────────────────
tweets  = []
next_token = None
page    = 0

while len(tweets) < MAX_TWEETS:
    page += 1
    params = (
        f'max_results=100'
        f'&tweet.fields=created_at,text'
        f'&exclude=retweets,replies'
    )
    if next_token:
        params += f'&pagination_token={next_token}'

    url  = f'https://api.twitter.com/2/users/{user_id}/tweets?{params}'
    resp = api_get(url)
    batch = resp.get('data', [])
    if not batch:
        break
    tweets.extend(batch)
    print(f"  Page {page}: fetched {len(batch)} tweets (total {len(tweets)})")
    next_token = resp.get('meta', {}).get('next_token')
    if not next_token:
        break
    # Free tier: 1 req / 15 min — comment this out if you have Basic+ tier
    print("  Waiting 15 min for free-tier rate limit …")
    time.sleep(901)

print(f"\nTotal tweets fetched: {len(tweets)}")

# ── WRITE OUTPUT ──────────────────────────────────────────────────────────────
out_path = os.path.normpath(OUTPUT_FILE)
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(f"@SportsAviation — Sports Team Flight Tracker\n")
    f.write(f"Fetched: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M')}\n")
    f.write(f"Total tweets: {len(tweets)}\n")
    f.write("=" * 70 + "\n\n")

    for t in tweets:
        date = t.get('created_at', '')[:10]
        text = t.get('text', '').replace('\n', ' ')
        f.write(f"[{date}] {text}\n")

print(f"Saved → {out_path}")
