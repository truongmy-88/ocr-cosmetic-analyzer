from flask import Flask, render_template, request, jsonify
import easyocr
import numpy as np
import requests
import re
from PIL import Image
from datetime import datetime, timezone, timedelta
from difflib import SequenceMatcher

app = Flask(__name__)

API_KEY = "4dd5ceee105b7ba3a6d68e3176e731a7c1ba0f8e98e156e30d8de455bce4b809"

_reader = None


def get_reader():
    global _reader
    if _reader is None:
        _reader = easyocr.Reader(['en', 'vi'], gpu=False)
    return _reader


brands = [
    "skin1004",
    "cerave",
    "simple",
    "medicube",
    "dermedic",
    "dr.g",
    "zo skin health",
    "surmedic",
    "mdicare",
    "drceutics",
    "floslek",
    "begen",
    "shegan",
    "vital",
    "cosan",
    "osen sui"
]

product_types = [
    "serum",
    "toner",
    "cleanser",
    "cream",
    "gel",
    "facial wash"
]

ingredients_db = [
    "niacinamide",
    "hyaluronic acid",
    "salicylic acid",
    "ceramide",
    "centella",
    "glutathione",
    "adenosine",
    "alpha arbutin",
    "tocopherol"
]


def clean_text(text):
    text = text.lower()
    text = re.sub(r'[^a-zA-ZÀ-ỹ0-9\s]', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def similarity(a, b):
    return SequenceMatcher(None, a, b).ratio()


def extract_brand(text):
    best_brand = "UNKNOWN"
    best_score = 0
    for brand in brands:
        score = similarity(brand, text)
        if brand in text:
            return brand.upper()
        if score > best_score:
            best_score = score
            best_brand = brand
    if best_score > 0.3:
        return best_brand.upper()
    return "UNKNOWN"


def extract_product_type(text):
    for p in product_types:
        if p in text:
            return p.upper()
    return "UNKNOWN"


def extract_product_name(text):
    words = text.split()
    keywords = [w for w in words if len(w) > 2]
    return " ".join(keywords[:10]).upper()


def extract_ingredients(text):
    return [ing for ing in ingredients_db if ing in text]


_search_cache = {}


def search_google_shopping(query):
    if query in _search_cache:
        return _search_cache[query]

    url = "https://serpapi.com/search.json"
    params = {
        "engine": "google_shopping",
        "q": f"{query} skincare chính hãng",
        "api_key": API_KEY,
        "hl": "vi",
        "gl": "vn",
        "num": 10
    }

    try:
        response = requests.get(url, params=params, timeout=15)
        data = response.json()
        if "error" in data:
            return {"error": data["error"]}
        results = data.get("shopping_results", [])
        _search_cache[query] = results
        return results
    except Exception as e:
        return {"error": str(e)}


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/analyze', methods=['POST'])
def analyze():
    if 'image' not in request.files:
        return jsonify({'error': 'No image provided'}), 400

    file = request.files['image']
    try:
        image = Image.open(file.stream).convert('RGB')
    except Exception as e:
        return jsonify({'error': f'Invalid image: {str(e)}'}), 400

    reader = get_reader()
    img = np.array(image)
    results = reader.readtext(img)

    texts = []
    confidences = []
    for item in results:
        txt = item[1]
        conf = item[2]
        if conf > 0.3:
            texts.append(txt)
            confidences.append(conf)

    raw_text = " ".join(texts)
    cleaned = clean_text(raw_text)

    brand = extract_brand(cleaned)
    product_type = extract_product_type(cleaned)
    product_name = extract_product_name(cleaned)
    ingredients = extract_ingredients(cleaned)

    ocr_score = round((sum(confidences) / len(confidences)) * 100, 2) if confidences else 0
    brand_score = 100 if brand != "UNKNOWN" else 50
    ingredient_score = min(len(ingredients) * 25, 100)
    search_query = f"{brand} {product_type}" if brand != "UNKNOWN" else product_name

    return jsonify({
        'raw_text': raw_text,
        'brand': brand,
        'product_type': product_type,
        'product_name': product_name,
        'ingredients': ingredients,
        'ocr_score': ocr_score,
        'brand_score': brand_score,
        'ingredient_score': ingredient_score,
        'search_query': search_query
    })


@app.route('/api/search', methods=['POST'])
def search():
    data = request.get_json()
    query = data.get('query', '')
    brand = data.get('brand', '')
    ocr_score = data.get('ocr_score', 0)
    brand_score = data.get('brand_score', 0)
    ingredient_score = data.get('ingredient_score', 0)

    if not query:
        return jsonify({'error': 'No query provided'}), 400

    products = search_google_shopping(query)

    if isinstance(products, dict) and 'error' in products:
        return jsonify(products), 500

    prices = []
    ratings = []
    reviews_list = []
    matched_products = 0

    for item in products[:5]:
        price = item.get('price', 'N/A')
        try:
            num_price = int(re.sub(r'[^0-9]', '', price))
            prices.append(num_price)
        except Exception:
            pass

        try:
            ratings.append(float(item.get('rating', 0)))
        except Exception:
            pass

        try:
            review_str = str(item.get('reviews', 0))
            reviews_list.append(int(re.sub(r'[^0-9]', '', review_str)))
        except Exception:
            pass

        title = item.get('title', '').lower()
        if brand.lower() in title:
            matched_products += 1

    search_score = round((matched_products / 5) * 100, 2) if products else 0

    overall_score = round(
        (ocr_score + brand_score + ingredient_score + search_score) / 4,
        2
    )

    analysis = {
        'lowest_price': min(prices) if prices else 0,
        'avg_price': int(sum(prices) / len(prices)) if prices else 0,
        'avg_rating': round(sum(ratings) / len(ratings), 2) if ratings else 0,
        'avg_reviews': int(sum(reviews_list) / len(reviews_list)) if reviews_list else 0,
        'search_score': search_score,
        'overall_score': overall_score,
        'timestamp': datetime.now(timezone(timedelta(hours=7))).strftime('%d/%m/%Y %H:%M:%S')
    }

    return jsonify({
        'products': products[:5],
        'analysis': analysis
    })


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5001)
