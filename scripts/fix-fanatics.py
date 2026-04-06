"""
fix-fanatics.py
Applies authoritative player/sport/photo data to all Fanatics Fest NYC 2026 entries.
Fixes scraper off-by-one mismatches and wrong sports.
"""
import json, re, urllib.request, time

DATA_FILE = 'data/live-events.json'

# Authoritative list: slug → (player name, sport, wikipedia photo URL)
ATHLETES = {
  "tom-brady":          ("Tom Brady",          "football",   "https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/25th_Laureus_World_Sports_Awards_-_London_2024_23_%28cropped%29.jpg/330px-25th_Laureus_World_Sports_Awards_-_London_2024_23_%28cropped%29.jpg"),
  "eli-manning":        ("Eli Manning",         "football",   "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Eli_Manning_crop.jpg/330px-Eli_Manning_crop.jpg"),
  "jerome-bettis":      ("Jerome Bettis",       "football",   "https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/Jerome_Bettis_2016.jpg/330px-Jerome_Bettis_2016.jpg"),
  "cris-carter":        ("Cris Carter",         "football",   "https://upload.wikimedia.org/wikipedia/commons/thumb/2/23/Cris_Carter_HOF.JPG/330px-Cris_Carter_HOF.JPG"),
  "jaxson-dart":        ("Jaxson Dart",         "football",   "https://upload.wikimedia.org/wikipedia/commons/f/fe/Jaxson_Dart_2025.jpg"),
  "cooper-dejean":      ("Cooper DeJean",       "football",   "https://upload.wikimedia.org/wikipedia/commons/thumb/1/11/Philadelphia_Eagles_Victory_Parade_2025_%28cropped2%29.jpg/330px-Philadelphia_Eagles_Victory_Parade_2025_%28cropped2%29.jpg"),
  "brett-favre":        ("Brett Favre",         "football",   "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/Brett_Favre_Super_Bowl_XLV_Media_Day_%28cropped%29.jpg/330px-Brett_Favre_Super_Bowl_XLV_Media_Day_%28cropped%29.jpg"),
  "jahmyr-gibbs":       ("Jahmyr Gibbs",        "football",   ""),
  "rob-gronkowski":     ("Rob Gronkowski",      "football",   "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/231208-N-QE848-2422_%28cropped%29.jpg/330px-231208-N-QE848-2422_%28cropped%29.jpg"),
  "michael-irvin":      ("Michael Irvin",       "football",   "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f1/Michael_Irvin_by_Gage_Skidmore.jpg/330px-Michael_Irvin_by_Gage_Skidmore.jpg"),
  "justin-jefferson":   ("Justin Jefferson",    "football",   ""),
  "malik-nabers":       ("Malik Nabers",        "football",   "https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/Malik_Nabers_Giants_welcome_2024.jpg/330px-Malik_Nabers_Giants_welcome_2024.jpg"),
  "puka-nacua":         ("Puka Nacua",          "football",   "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/Puka_Nacua_FanDuel_International_Series_2024_%28cropped%29.jpg/330px-Puka_Nacua_FanDuel_International_Series_2024_%28cropped%29.jpg"),
  "deebo-samuel":       ("Deebo Samuel",        "football",   "https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Deebo_Samuel_2025_week_2.jpg/330px-Deebo_Samuel_2025_week_2.jpg"),
  "jameis-winston":     ("Jameis Winston",      "football",   "https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/WFT_vs._Saints_%2851587978416%29_%28cropped%29.jpg/330px-WFT_vs._Saints_%2851587978416%29_%28cropped%29.jpg"),
  "ray-lewis":          ("Ray Lewis",           "football",   "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/Ray_Lewis_2015_%28cropped%29.jpg/330px-Ray_Lewis_2015_%28cropped%29.jpg"),
  "joe-montana":        ("Joe Montana",         "football",   "https://upload.wikimedia.org/wikipedia/commons/thumb/2/28/Joe_Montana_Super_Bowl_XIX.jpg/330px-Joe_Montana_Super_Bowl_XIX.jpg"),
  "jerry-rice":         ("Jerry Rice",          "football",   "https://upload.wikimedia.org/wikipedia/commons/thumb/0/01/Super_Bowl_44_Miami_Florida_Jerry_Rice_%28cropped%29.jpg/330px-Super_Bowl_44_Miami_Florida_Jerry_Rice_%28cropped%29.jpg"),
  "lawrence-taylor":    ("Lawrence Taylor",     "football",   "https://upload.wikimedia.org/wikipedia/commons/8/81/Lawrence_Taylor_in_2025_%28cropped%29.jpg"),
  "barry-sanders":      ("Barry Sanders",       "football",   "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Barry_Sanders_2019.jpg/330px-Barry_Sanders_2019.jpg"),
  "kevin-durant":       ("Kevin Durant",        "basketball", "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Kevin_Durant%2C_Paris_2024.jpg/330px-Kevin_Durant%2C_Paris_2024.jpg"),
  "jalen-brunson":      ("Jalen Brunson",       "basketball", "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f2/Jalen_Brunson_2023_%28cropped%29.jpg/330px-Jalen_Brunson_2023_%28cropped%29.jpg"),
  "paolo-banchero":     ("Paolo Banchero",      "basketball", "https://upload.wikimedia.org/wikipedia/commons/thumb/5/54/Paolo_Banchero.png/330px-Paolo_Banchero.png"),
  "draymond-green":     ("Draymond Green",      "basketball", "https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/Draymond_Green_2022.jpg/330px-Draymond_Green_2022.jpg"),
  "tyrese-haliburton":  ("Tyrese Haliburton",   "basketball", "https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/1_tyrese_haliburton_2023_%28cropped%29.jpg/330px-1_tyrese_haliburton_2023_%28cropped%29.jpg"),
  "james-harden":       ("James Harden",        "basketball", "https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/Harden_dribbling_midcourt_%28cropped%29.jpg/330px-Harden_dribbling_midcourt_%28cropped%29.jpg"),
  "josh-hart":          ("Josh Hart",           "basketball", "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/Josh_Hart%2C_2022_%28cropped%29.jpg/330px-Josh_Hart%2C_2022_%28cropped%29.jpg"),
  "grant-hill":         ("Grant Hill",          "basketball", "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Grant_Hill_2007-12-08.jpg/330px-Grant_Hill_2007-12-08.jpg"),
  "allen-iverson":      ("Allen Iverson",       "basketball", "https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/Allen_Iverson_headshot.jpg/330px-Allen_Iverson_headshot.jpg"),
  "patrick-ewing":      ("Patrick Ewing",       "basketball", "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Patrick_Ewing_2021_%28cropped%29.jpg/330px-Patrick_Ewing_2021_%28cropped%29.jpg"),
  "paul-pierce":        ("Paul Pierce",         "basketball", "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Paul_Pierce_2008-01-13.jpg/330px-Paul_Pierce_2008-01-13.jpg"),
  "scottie-pippen":     ("Scottie Pippen",      "basketball", "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Scottie_Pippen_5-2-22_%28cropped%29.jpg/330px-Scottie_Pippen_5-2-22_%28cropped%29.jpg"),
  "dennis-rodman":      ("Dennis Rodman",       "basketball", "https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/Dennis_Rodman_02_%2834546826591%29_%28cropped%29.jpg/330px-Dennis_Rodman_02_%2834546826591%29_%28cropped%29.jpg"),
  "karl-anthony-towns": ("Karl-Anthony Towns",  "basketball", "https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/Karl-Anthony_Towns_%28cropped%29.jpg/330px-Karl-Anthony_Towns_%28cropped%29.jpg"),
  "klay-thompson":      ("Klay Thompson",       "basketball", "https://upload.wikimedia.org/wikipedia/commons/thumb/8/81/Klay_Thompson_%28cropped%29.jpg/330px-Klay_Thompson_%28cropped%29.jpg"),
  "trae-young":         ("Trae Young",          "basketball", "https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/Trae_Young_%282022_All-Star%29_%28cropped%29.jpg/330px-Trae_Young_%282022_All-Star%29_%28cropped%29.jpg"),
  "diana-taurasi":      ("Diana Taurasi",       "basketball", "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/Diana_Taurasi_2024_%28cropped%29.jpg/330px-Diana_Taurasi_2024_%28cropped%29.jpg"),
  "aaron-judge":        ("Aaron Judge",         "baseball",   "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b1/Aaron_Judge_posing_with_fans_%28cropped%29.jpg/330px-Aaron_Judge_posing_with_fans_%28cropped%29.jpg"),
  "david-ortiz":        ("David Ortiz",         "baseball",   "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/David_Ortiz_on_July_27%2C_2016.jpg/330px-David_Ortiz_on_July_27%2C_2016.jpg"),
  "cody-bellinger":     ("Cody Bellinger",      "baseball",   "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dc/Cody_Bellinger_7_24_18.jpg/330px-Cody_Bellinger_7_24_18.jpg"),
  "roger-clemens":      ("Roger Clemens",       "baseball",   "https://upload.wikimedia.org/wikipedia/commons/1/15/Lipofsky-Roger-Clemens.jpg"),
  "freddie-freeman":    ("Freddie Freeman",     "baseball",   "https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/Freddie_Freeman_-_Dodgers_%28cropped%29.jpg/330px-Freddie_Freeman_-_Dodgers_%28cropped%29.jpg"),
  "keith-hernandez":    ("Keith Hernandez",     "baseball",   "https://upload.wikimedia.org/wikipedia/commons/5/55/Keith_Hernandez_1986.jpg"),
  "don-mattingly":      ("Don Mattingly",       "baseball",   "https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/Don_Mattingly_on_April_4%2C_2017.jpg/330px-Don_Mattingly_on_April_4%2C_2017.jpg"),
  "mike-piazza":        ("Mike Piazza",         "baseball",   "https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/Mike_Piazza_HOF_Press_Conference.jpg/330px-Mike_Piazza_HOF_Press_Conference.jpg"),
  "jose-reyes":         ("Jose Reyes",          "baseball",   "https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/Jos%C3%A9_Reyes_before_2016_NL_Wild_Card_Game.jpg/330px-Jos%C3%A9_Reyes_before_2016_NL_Wild_Card_Game.jpg"),
  "cc-sabathia":        ("CC Sabathia",         "baseball",   "https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/CC_Sabathia_pitching_against_the_Cleveland_Indians_%28cropped%29.jpg/330px-CC_Sabathia_pitching_against_the_Cleveland_Indians_%28cropped%29.jpg"),
  "blake-snell":        ("Blake Snell",         "baseball",   "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/BlakeSnell_%28cropped%29.jpg/330px-BlakeSnell_%28cropped%29.jpg"),
  "darryl-strawberry":  ("Darryl Strawberry",   "baseball",   "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/Daryl_Strawberry_%2829943640613%29_%28cropped%29.jpg/330px-Daryl_Strawberry_%2829943640613%29_%28cropped%29.jpg"),
  "chase-utley":        ("Chase Utley",         "baseball",   "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Chase_Utley_2009.jpg/330px-Chase_Utley_2009.jpg"),
  "kyle-tucker":        ("Kyle Tucker",         "baseball",   "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Kyle_Tucker_%284878491795%29_%28cropped%29.jpg/330px-Kyle_Tucker_%284878491795%29_%28cropped%29.jpg"),
  "will-smith":         ("Will Smith",          "baseball",   "https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/Will_Smith_Los_Angeles_Dodgers_%2848427251081%29_%28cropped%29.jpg/330px-Will_Smith_Los_Angeles_Dodgers_%2848427251081%29_%28cropped%29.jpg"),
  "anthony-volpe":      ("Anthony Volpe",       "baseball",   "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c7/Anthony_Volpe_%2852073432804%29_%28cropped%29.jpg/330px-Anthony_Volpe_%2852073432804%29_%28cropped%29.jpg"),
  "austin-wells":       ("Austin Wells",        "baseball",   ""),
  "david-wright":       ("David Wright",        "baseball",   "https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/WrightMarch2016.jpg/330px-WrightMarch2016.jpg"),
  "jorge-posada":       ("Jorge Posada",        "baseball",   ""),
  "mariano-rivera":     ("Mariano Rivera",      "baseball",   ""),
  "andy-pettitte":      ("Andy Pettitte",       "baseball",   ""),
  "john-cena":          ("John Cena",           "wrestling",  "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2e/John_Cena_by_Gage_Skidmore_2.jpg/330px-John_Cena_by_Gage_Skidmore_2.jpg"),
  "rhea-ripley":        ("Rhea Ripley",         "wrestling",  "https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/Rhea_Ripley_040724_%28cropped%29.jpg/330px-Rhea_Ripley_040724_%28cropped%29.jpg"),
  "cody-rhodes":        ("Cody Rhodes",         "wrestling",  "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5d/Cody_Rhodes%2C_April_2024_%28cropped%29.jpg/330px-Cody_Rhodes%2C_April_2024_%28cropped%29.jpg"),
  "bianca-belair":      ("Bianca Belair",       "wrestling",  "https://upload.wikimedia.org/wikipedia/commons/thumb/d/df/Bianca_Belair_042025_%28cropped%29.jpg/330px-Bianca_Belair_042025_%28cropped%29.jpg"),
  "charlotte-flair":    ("Charlotte Flair",     "wrestling",  "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Charlotte_Flair_RR25_%28cropped%29.jpg/330px-Charlotte_Flair_RR25_%28cropped%29.jpg"),
  "the-undertaker":     ("The Undertaker",      "wrestling",  "https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/The_Undertaker_US_Marine_Corps_2010_%28cropped%29.jpg/330px-The_Undertaker_US_Marine_Corps_2010_%28cropped%29.jpg"),
  "becky-lynch":        ("Becky Lynch",         "wrestling",  "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/Becky_Lynch_Galaxycon_%28cropped%29.jpg/330px-Becky_Lynch_Galaxycon_%28cropped%29.jpg"),
  "liv-morgan":         ("Liv Morgan",          "wrestling",  "https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/Big_E%2C_Liv_Morgan_%28cropped%29.jpg/330px-Big_E%2C_Liv_Morgan_%28cropped%29.jpg"),
  "randy-orton":        ("Randy Orton",         "wrestling",  "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d5/Randy_Orton_RR24_%28cropped%29.jpg/330px-Randy_Orton_RR24_%28cropped%29.jpg"),
  "logan-paul":         ("Logan Paul",          "wrestling",  "https://upload.wikimedia.org/wikipedia/commons/thumb/5/50/Logan_Paul_RR25_%28cropped%29.jpg/330px-Logan_Paul_RR25_%28cropped%29.jpg"),
  "iyo-sky":            ("Iyo Sky",             "wrestling",  "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Iyo_Sky_042025_%28Cropped%29.jpg/330px-Iyo_Sky_042025_%28Cropped%29.jpg"),
  "tiffany-stratton":   ("Tiffany Stratton",    "wrestling",  "https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/Tiffy_Time_042025_%28cropped%29.jpg/330px-Tiffy_Time_042025_%28cropped%29.jpg"),
  "jey-uso":            ("Jey Uso",             "wrestling",  "https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Jey_Uso_RR25_%281%29_%28cropped%29.jpg/330px-Jey_Uso_RR25_%281%29_%28cropped%29.jpg"),
  "stephanie-vaquer":   ("Stephanie Vaquer",    "wrestling",  "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e2/Stephanie_Vaquer_42025_%28cropped%29.jpg/330px-Stephanie_Vaquer_42025_%28cropped%29.jpg"),
  "marc-andre-fleury":  ("Marc-Andre Fleury",   "hockey",     "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ee/Marc-Andre_Fleury_2018-02-06_1.jpg/330px-Marc-Andre_Fleury_2018-02-06_1.jpg"),
  "patrick-kane":       ("Patrick Kane",        "hockey",     "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f3/Patrick_Kane_Red_Wings_%28cropped%29.jpg/330px-Patrick_Kane_Red_Wings_%28cropped%29.jpg"),
  "henrik-lundqvist":   ("Henrik Lundqvist",    "hockey",     "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dc/Henrik_Lundqvist_by_Gage_Skidmore_%28cropped%29.jpg/330px-Henrik_Lundqvist_by_Gage_Skidmore_%28cropped%29.jpg"),
  "justin-gaethje":     ("Justin Gaethje",      "mma",        "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Justin_Gaethje_at_press_conference_%28cropped%29.jpg/330px-Justin_Gaethje_at_press_conference_%28cropped%29.jpg"),
  "midge-purce":        ("Midge Purce",         "soccer",     "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5d/Midge_Purce_during_Got_Her_Back_Campaign_%28cropped%29.jpg/330px-Midge_Purce_during_Got_Her_Back_Campaign_%28cropped%29.jpg"),
  "mike-tyson":         ("Mike Tyson",          "boxing",     "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ee/Mike_Tyson_Photo_Op_Gage_Skidmore_%28cropped%29.jpg/330px-Mike_Tyson_Photo_Op_Gage_Skidmore_%28cropped%29.jpg"),
  "jordan-chiles":      ("Jordan Chiles",       "other",      "https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/Jordan_Chiles_at_Essence_Festival_2024_%28cropped%29.jpg/330px-Jordan_Chiles_at_Essence_Festival_2024_%28cropped%29.jpg"),
  "kevin-hart":         ("Kevin Hart",          "celeb",      "https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/Kevin_Hart_2014_%28cropped%29.jpg/330px-Kevin_Hart_2014_%28cropped%29.jpg"),
  "jay-z":              ("Jay-Z",               "celeb",      "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/Jay-Z_%40_Shawn_%27Jay-Z%27_Carter_%28cropped%29.jpg/330px-Jay-Z_%40_Shawn_%27Jay-Z%27_Carter_%28cropped%29.jpg"),
  "travis-scott":       ("Travis Scott",        "celeb",      "https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/2025-0120_Cole_Gahagan_%28cropped%29.jpg/330px-2025-0120_Cole_Gahagan_%28cropped%29.jpg"),
  "odell-beckham-jr":   ("Odell Beckham Jr.",   "football",   ""),
  "cam-skattebo":       ("Cam Skattebo",        "football",   ""),
  "megan-keller":       ("Megan Keller",        "hockey",     ""),
  "caroline-kk-harvey": ("Caroline Harvey",     "other",      ""),
}

# Fetch missing Wikipedia photos for newly mapped athletes
def get_wiki_photo(slug_guess):
    try:
        name = slug_guess.replace('-', '_').title()
        url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{name}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as r:
            d = json.loads(r.read())
            return d.get("thumbnail", {}).get("source", "")
    except:
        return ""

# Fetch missing photos
missing = [(slug, name) for slug, (name, sport, img) in ATHLETES.items() if not img]
for slug, name in missing:
    wiki_slug = name.replace(' ', '_').replace('.', '').replace('-', '_')
    photo = get_wiki_photo(wiki_slug)
    if photo:
        player, sport, _ = ATHLETES[slug]
        ATHLETES[slug] = (player, sport, photo)
        print(f"Found photo for {name}: {photo[:60]}")
    time.sleep(0.2)

# Apply fixes
with open(DATA_FILE, encoding='utf-8') as f:
    data = json.load(f)

fixed = 0
for ev in data['events']:
    eid = ev.get('id', '')
    if 'fanatics-fest-nyc' not in eid:
        continue
    slug = eid.replace('epic_fanatics-fest-nyc_', '')
    if slug not in ATHLETES:
        continue
    player, sport, img = ATHLETES[slug]
    changed = False
    if ev.get('player') != player:
        print(f"FIX player: {slug!r}: {ev.get('player')!r} -> {player!r}")
        ev['player'] = player
        changed = True
    if ev.get('sport') != sport:
        print(f"FIX sport:  {slug!r}: {ev.get('sport')!r} -> {sport!r}")
        ev['sport'] = sport
        changed = True
    if img and ev.get('img') != img:
        ev['img'] = img
        changed = True
    elif not img and ev.get('img'):
        pass  # keep whatever photo was previously set
    if changed:
        fixed += 1

# Also clean up scraper noise in player names like "Foo: Coming April 24th"
for ev in data['events']:
    if 'fanatics-fest-nyc' not in ev.get('id',''):
        continue
    slug = ev['id'].replace('epic_fanatics-fest-nyc_', '')
    if slug in ATHLETES:
        continue  # already handled above
    # Clean suffix noise
    clean = re.sub(r'\s*:\s*(Coming|Going).*', '', ev.get('player', '')).strip()
    if clean != ev.get('player'):
        print(f"CLEAN: {ev['id']} player {ev['player']!r} -> {clean!r}")
        ev['player'] = clean

with open(DATA_FILE, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"\nDone: {fixed} entries corrected.")
