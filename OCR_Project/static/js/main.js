// ─── State ────────────────────────────────────────────────────────────────────
let selectedFile = null;
let analysisData = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const dropZone        = document.getElementById('drop-zone');
const fileInput       = document.getElementById('file-input');
const uploadSection   = document.getElementById('upload-section');
const previewSection  = document.getElementById('preview-section');
const previewImg      = document.getElementById('preview-img');
const resetBtn        = document.getElementById('reset-btn');
const analyzeBtn      = document.getElementById('analyze-btn');
const loading         = document.getElementById('loading');
const loadingText     = document.getElementById('loading-text');
const resultsSection  = document.getElementById('results-section');

// ─── Drag-and-drop ────────────────────────────────────────────────────────────
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-active');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-active');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-active');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
        handleFileSelect(file);
    }
});

fileInput.addEventListener('change', (e) => { if (e.target.files[0]) handleFileSelect(e.target.files[0]); });

// ─── File selection ───────────────────────────────────────────────────────────
function handleFileSelect(file) {
    selectedFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
        previewImg.src = e.target.result;
        uploadSection.classList.add('hidden');
        previewSection.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
}

// ─── Reset ────────────────────────────────────────────────────────────────────
function resetAll() {
    selectedFile = null;
    analysisData = null;
    fileInput.value = '';
    uploadSection.classList.remove('hidden');
    previewSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
    loading.classList.add('hidden');
    // reset products-loading for next run
    document.getElementById('products-loading').classList.remove('hidden');
    document.getElementById('products-grid').classList.add('hidden');
    document.getElementById('no-products').classList.add('hidden');
    document.getElementById('price-analysis-section').classList.add('hidden');
    document.getElementById('rating-analysis-section').classList.add('hidden');
    document.getElementById('scorecard-section').classList.add('hidden');
    document.getElementById('data-table-section').classList.add('hidden');
}

resetBtn.addEventListener('click', resetAll);
document.getElementById('analyze-another-btn').addEventListener('click', () => {
    resetAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ─── Analyze ──────────────────────────────────────────────────────────────────
analyzeBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    previewSection.classList.add('hidden');
    loading.classList.remove('hidden');
    loadingText.textContent = 'Running OCR analysis…';

    const formData = new FormData();
    formData.append('image', selectedFile);

    try {
        // Step 1: OCR + NLP
        const res = await fetch('/api/analyze', { method: 'POST', body: formData });
        const data = await res.json();

        if (data.error) {
            showError('Analysis failed: ' + data.error);
            return;
        }

        analysisData = data;

        // Show results panel with OCR/NLP, keep market section in loading state
        loading.classList.add('hidden');
        showAnalysisResults(data);

        // Step 2: Market search (products-loading spinner still visible)
        const searchRes = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query:            data.search_query,
                brand:            data.brand,
                ocr_score:        data.ocr_score,
                brand_score:      data.brand_score,
                ingredient_score: data.ingredient_score
            })
        });

        const searchData = await searchRes.json();
        showSearchResults(searchData, data);

    } catch (err) {
        showError('Request failed: ' + err.message);
    }
});

// ─── Error helper ─────────────────────────────────────────────────────────────
function showError(msg) {
    loading.classList.add('hidden');
    previewSection.classList.remove('hidden');
    alert(msg);
}

// ─── Show OCR / NLP results ───────────────────────────────────────────────────
function showAnalysisResults(data) {
    resultsSection.classList.remove('hidden');
    resultsSection.classList.add('fade-in');

    document.getElementById('result-img').src = previewImg.src;
    document.getElementById('ocr-text').textContent = data.raw_text || 'No text extracted';
    document.getElementById('brand-value').textContent  = data.brand;
    document.getElementById('type-value').textContent   = data.product_type;
    document.getElementById('name-value').textContent   = data.product_name;

    const ingList = document.getElementById('ingredients-list');
    const noIng   = document.getElementById('no-ingredients');
    ingList.innerHTML = '';

    if (data.ingredients && data.ingredients.length > 0) {
        noIng.classList.add('hidden');
        data.ingredients.forEach(ing => {
            const tag = document.createElement('span');
            tag.className = 'ingredient-tag bg-purple-100 text-purple-700 text-xs font-semibold px-3 py-1.5 rounded-full cursor-default';
            tag.textContent = '✔ ' + ing;
            ingList.appendChild(tag);
        });
    } else {
        noIng.classList.remove('hidden');
    }

    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Show market search results ───────────────────────────────────────────────
function showSearchResults(searchData, nlpData) {
    const productsLoading = document.getElementById('products-loading');
    const productsGrid    = document.getElementById('products-grid');
    const noProducts      = document.getElementById('no-products');

    productsLoading.classList.add('hidden');

    if (searchData.error) {
        noProducts.textContent = '⚠ Search error: ' + searchData.error;
        noProducts.classList.remove('hidden');
        showScorecard({ ocr: nlpData.ocr_score, brand: nlpData.brand_score, ingredient: nlpData.ingredient_score, search: 0, overall: 0 });
        showDataTable(nlpData, 0);
        return;
    }

    const products = searchData.products || [];
    const analysis = searchData.analysis || {};

    // Timestamp badge
    document.getElementById('search-timestamp').textContent = '⏰ ' + (analysis.timestamp || '');

    if (products.length === 0) {
        noProducts.classList.remove('hidden');
    } else {
        productsGrid.innerHTML = '';
        products.forEach((item, idx) => {
            const card = createProductCard(item);
            card.style.animationDelay = `${idx * 60}ms`;
            productsGrid.appendChild(card);
        });
        productsGrid.classList.remove('hidden');
    }

    // Price analysis
    if (analysis.lowest_price || analysis.avg_price) {
        document.getElementById('price-analysis-section').classList.remove('hidden');
        document.getElementById('price-analysis-section').classList.add('fade-in');
        document.getElementById('lowest-price').textContent = formatPrice(analysis.lowest_price);
        document.getElementById('avg-price').textContent    = formatPrice(analysis.avg_price);
        document.getElementById('avg-rating').textContent   = analysis.avg_rating || '—';
        document.getElementById('rating-stars').textContent = renderStars(analysis.avg_rating);
        document.getElementById('avg-reviews').textContent  = (analysis.avg_reviews || 0).toLocaleString();

        // Rating & Review sub-section
        document.getElementById('rating-analysis-section').classList.remove('hidden');
        document.getElementById('avg-rating-2').textContent  = analysis.avg_rating || '—';
        document.getElementById('avg-reviews-2').textContent = (analysis.avg_reviews || 0).toLocaleString();
    }

    // Scorecard
    showScorecard({
        ocr:        nlpData.ocr_score        || 0,
        brand:      nlpData.brand_score      || 0,
        ingredient: nlpData.ingredient_score || 0,
        search:     analysis.search_score    || 0,
        overall:    analysis.overall_score   || 0
    });

    // Structured data table
    showDataTable(nlpData, analysis.overall_score || 0);
}

// ─── Product card ─────────────────────────────────────────────────────────────
function createProductCard(item) {
    const title     = item.title         || 'No title';
    const price     = item.price         || 'N/A';
    const rating    = item.rating        || null;
    const reviews   = item.reviews       || '0';
    const source    = item.source        || 'Unknown';
    const thumbnail = item.thumbnail     || '';
    const link      = item.product_link  || item.link || '#';

    const card = document.createElement('div');
    card.className = 'product-card bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col fade-in';

    const imgSection = thumbnail
        ? `<div class="h-48 bg-gray-50 flex items-center justify-center overflow-hidden border-b border-gray-100">
               <img src="${escHtml(thumbnail)}" alt="${escHtml(title)}" class="w-full h-full object-contain p-3">
           </div>`
        : `<div class="h-48 bg-gray-50 flex items-center justify-center border-b border-gray-100 text-5xl">🧴</div>`;

    const starsHtml = rating
        ? `<div class="flex items-center gap-1.5 mt-1">
               <span class="text-amber-400 text-xs leading-none">${renderStars(rating)}</span>
               <span class="text-xs text-gray-400">${rating} (${escHtml(String(reviews))})</span>
           </div>`
        : '';

    card.innerHTML = `
        ${imgSection}
        <div class="p-4 flex flex-col flex-1">
            <h4 class="font-semibold text-gray-800 text-sm line-clamp-2 mb-3 leading-snug">${escHtml(title)}</h4>
            <div class="flex-1 space-y-1 mb-4">
                <p class="text-rose-600 font-extrabold text-lg">${escHtml(price)}</p>
                ${starsHtml}
                <p class="text-xs text-gray-400 flex items-center gap-1 pt-1">
                    <span>🏪</span><span>${escHtml(source)}</span>
                </p>
            </div>
            <a href="${escHtml(link)}" target="_blank" rel="noopener noreferrer"
               class="block text-center bg-rose-50 hover:bg-rose-500 text-rose-600 hover:text-white
                      font-semibold text-sm py-2.5 rounded-xl transition-colors duration-150">
                View Product →
            </a>
        </div>
    `;

    return card;
}

// ─── Scorecard ────────────────────────────────────────────────────────────────
function showScorecard(scores) {
    const section = document.getElementById('scorecard-section');
    section.classList.remove('hidden');
    section.classList.add('fade-in');

    // Delay so CSS transition fires after the element is visible
    requestAnimationFrame(() => {
        setTimeout(() => {
            setBar('ocr-bar',        'ocr-score-label',        scores.ocr);
            setBar('brand-bar',      'brand-score-label',      scores.brand);
            setBar('ingredient-bar', 'ingredient-score-label', scores.ingredient);
            setBar('search-bar',     'search-score-label',     scores.search);
            setBar('overall-bar',    'overall-score-label',    scores.overall);
        }, 80);
    });
}

function setBar(barId, labelId, value) {
    document.getElementById(barId).style.width   = `${value}%`;
    document.getElementById(labelId).textContent = `${value}%`;
}

// ─── Structured data table ────────────────────────────────────────────────────
function showDataTable(data, overallScore) {
    const section = document.getElementById('data-table-section');
    section.classList.remove('hidden');
    section.classList.add('fade-in');

    document.getElementById('table-brand').textContent       = data.brand;
    document.getElementById('table-name').textContent        = data.product_name;
    document.getElementById('table-type').textContent        = data.product_type;
    document.getElementById('table-ingredients').textContent = (data.ingredients || []).join(', ') || '—';
    document.getElementById('table-ocr').textContent         = `${data.ocr_score}%`;
    document.getElementById('table-overall').textContent     = `${overallScore}%`;
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function formatPrice(price) {
    if (!price) return '—';
    return price.toLocaleString('vi-VN');
}

function renderStars(rating) {
    if (!rating) return '';
    const full  = Math.floor(rating);
    const half  = rating - full >= 0.5 ? 1 : 0;
    const empty = 5 - full - half;
    return '★'.repeat(full) + (half ? '✦' : '') + '☆'.repeat(empty);
}

function escHtml(str) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(String(str)));
    return d.innerHTML;
}
