#!/usr/bin/env python3
"""
Scrape product data from https://elkhalily.com/product-category/power-tools/

Install:   pip install requests beautifulsoup4 lxml
Run:       python scrape_elkhalily.py
Options:   python scrape_elkhalily.py --details      (also visit each product page:
                                                      description, images, specs)
           python scrape_elkhalily.py --max-pages 3  (quick test)

Output:    elkhalily_products.csv  (UTF-8 with BOM so Arabic opens correctly in Excel)
           elkhalily_products.json
"""
import argparse
import csv
import json
import re
import time
from urllib.parse import urlparse, parse_qs

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://elkhalily.com/product-category/power-tools/"
PER_PAGE = 24          # the site offers 9 / 12 / 18 / 24
DELAY = 1.0            # seconds between requests - be polite to the server

session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "ar,en;q=0.8",
})


def get(url, params=None, retries=3):
    for attempt in range(retries):
        try:
            r = session.get(url, params=params, timeout=30)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.text
        except requests.RequestException as e:
            print(f"  ! {e} (attempt {attempt + 1}/{retries})")
            time.sleep(2 * (attempt + 1))
    return None


def num(text):
    """'1,300.0 EGP' -> 1300.0"""
    if not text:
        return None
    m = re.search(r"[\d,]+(?:\.\d+)?", text)
    return float(m.group(0).replace(",", "")) if m else None


def parse_card(card):
    # Title + URL
    a = card.select_one(
        ".woocommerce-loop-product__title a, h2 a, h3 a, .product-title a"
    )
    if not a:
        return None
    name = a.get_text(strip=True)
    url = a["href"]

    # Product ID (from add-to-cart link / compare link / data attribute)
    pid = None
    for link in card.select("a[href]"):
        q = parse_qs(urlparse(link["href"]).query)
        if "add-to-cart" in q:
            pid = q["add-to-cart"][0]
            break
        if "product_id" in q:
            pid = q["product_id"][0]
    if not pid:
        btn = card.select_one("[data-product_id]")
        pid = btn["data-product_id"] if btn else None

    # Categories & brand (links)
    categories = [
        l.get_text(strip=True)
        for l in card.select("a[href*='/product-category/']")
        if l.get_text(strip=True)
    ]
    brand = None
    b = card.select_one("a[href*='filter_brand=']")
    if b:
        brand = b.get_text(strip=True)

    # Prices: <del> = regular, <ins> = sale, otherwise single price
    price_box = card.select_one(".price") or card
    del_el = price_box.select_one("del .amount, del")
    ins_el = price_box.select_one("ins .amount, ins")
    if del_el and ins_el:
        regular, sale = num(del_el.get_text()), num(ins_el.get_text())
    else:
        amt = price_box.select_one(".amount")
        regular, sale = (num(amt.get_text()) if amt else None), None

    discount = None
    badge = card.select_one(".onsale, .product-label")
    if badge:
        m = re.search(r"\d+", badge.get_text())
        discount = int(m.group(0)) if m else None

    text = card.get_text(" ", strip=True)
    m = re.search(r"كود التخزين:\s*(\S+(?: \S+)?)", text)
    sku = m.group(1).strip() if m else None
    # trim stray words that can follow the SKU on the same line
    if sku:
        sku = re.split(r"\s+(?:الماركة|Total|\|)", sku)[0].strip()

    in_stock = "في المخزن" in text
    out_of_stock = "نفذت" in text or "out of stock" in text.lower()

    img = card.select_one("img")
    image = None
    if img:
        image = img.get("data-src") or img.get("data-lazy-src") or img.get("src")

    return {
        "id": pid,
        "name": name,
        "url": url,
        "sku": sku,
        "brand": brand,
        "categories": " | ".join(dict.fromkeys(categories)),
        "regular_price_egp": regular,
        "sale_price_egp": sale,
        "discount_pct": discount,
        "in_stock": in_stock and not out_of_stock,
        "image": image,
    }


def parse_details(html):
    soup = BeautifulSoup(html, "lxml")
    desc = soup.select_one(
        ".woocommerce-product-details__short-description, #tab-description"
    )
    images = []
    for img in soup.select(".woocommerce-product-gallery img"):
        src = img.get("data-large_image") or img.get("data-src") or img.get("src")
        if src and src not in images:
            images.append(src)
    specs = {}
    for row in soup.select("table.woocommerce-product-attributes tr, table.shop_attributes tr"):
        k, v = row.find("th"), row.find("td")
        if k and v:
            specs[k.get_text(strip=True)] = v.get_text(" ", strip=True)
    return {
        "description": desc.get_text(" ", strip=True) if desc else None,
        "images": " | ".join(images),
        "specs": json.dumps(specs, ensure_ascii=False),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fast", action="store_true",
                    help="skip visiting each product page (listing data only)")
    ap.add_argument("--max-pages", type=int, default=None)
    args = ap.parse_args()
    args.details = not args.fast

    products, seen = [], set()
    page = 1
    while True:
        if args.max_pages and page > args.max_pages:
            break
        url = BASE_URL if page == 1 else f"{BASE_URL}page/{page}/"
        print(f"Page {page}: {url}")
        html = get(url, params={"per_page": PER_PAGE})
        if not html:
            break
        soup = BeautifulSoup(html, "lxml")
        cards = soup.select("div.product, li.product")
        # keep only real product cards (those with a title link)
        cards = [c for c in cards if c.select_one("h2 a, h3 a, .product-title a")]
        if not cards:
            break

        new = 0
        for c in cards:
            p = parse_card(c)
            if not p:
                continue
            key = p["id"] or p["url"]
            if key in seen:
                continue
            seen.add(key)
            products.append(p)
            new += 1
        print(f"  +{new} new (total {len(products)})")
        if new == 0:
            break
        page += 1
        time.sleep(DELAY)

    if args.details:
        for i, p in enumerate(products, 1):
            print(f"Details {i}/{len(products)}: {p['name'][:50]}")
            html = get(p["url"])
            if html:
                p.update(parse_details(html))
            time.sleep(DELAY)

    if not products:
        print("No products found - the site layout may have changed.")
        return

    fields = list(products[0].keys())
    for p in products:
        for k in p:
            if k not in fields:
                fields.append(k)

    with open("elkhalily_products.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(products)
    with open("elkhalily_products.json", "w", encoding="utf-8") as f:
        json.dump(products, f, ensure_ascii=False, indent=2)

    print(f"\nDone: {len(products)} products -> elkhalily_products.csv / .json")


if __name__ == "__main__":
    main()
