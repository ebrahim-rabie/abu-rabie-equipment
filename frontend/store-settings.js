(() => {
    const apiBase = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
        ? (window.location.port === '5000' ? '/api' : 'http://localhost:5000/api')
        : '/api';

    window.storeSettings = { showPrices: true };
    document.documentElement.dataset.priceVisibility = 'loading';
    window.storeSettingsReady = fetch(`${apiBase}/settings/public`)
        .then((response) => response.json())
        .then((result) => {
            if (result.success && typeof result.data?.showPrices === 'boolean') {
                window.storeSettings.showPrices = result.data.showPrices;
            }
            document.documentElement.dataset.priceVisibility = window.storeSettings.showPrices ? 'shown' : 'hidden';
            return window.storeSettings;
        })
        .catch(() => {
            window.storeSettings.showPrices = true;
            document.documentElement.dataset.priceVisibility = 'shown';
            return window.storeSettings;
        });
})();
