const CONFIG_2026 = {
    BASE_SALARY: 2340000,
    REGIONAL_MIN_WAGE: {
        1: 5310000,
        2: 4730000,
        3: 4140000,
        4: 3700000
    },
    INSURANCE: {
        BHXH: 0.08,
        BHYT: 0.015,
        BHTN: 0.01
    },
    DEDUCTIONS: {
        PERSONAL: 15500000,
        DEPENDENT: 6200000
    },
    TAX_BRACKETS: [
        { max: 10000000, rate: 0.05, subtract: 0 },
        { max: 30000000, rate: 0.10, subtract: 500000 },
        { max: 60000000, rate: 0.20, subtract: 3500000 },
        { max: 100000000, rate: 0.30, subtract: 9500000 },
        { max: Infinity, rate: 0.35, subtract: 14500000 }
    ]
};

function formatCurrency(amount) {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}

function calculatePIT(taxableIncome) {
    if (taxableIncome <= 0) return 0;

    for (const bracket of CONFIG_2026.TAX_BRACKETS) {
        if (taxableIncome <= bracket.max) {
            return taxableIncome * bracket.rate - bracket.subtract;
        }
    }
    return 0; // Should not reach here due to Infinity
}

function calculateGrossToNet(gross, dependents, region) {
    // 1. Insurance Bases
    const bhxhBaseCap = 20 * CONFIG_2026.BASE_SALARY;
    const bhtnBaseCap = 20 * CONFIG_2026.REGIONAL_MIN_WAGE[region];

    const salaryForBHXH = Math.min(gross, bhxhBaseCap);
    const salaryForBHTN = Math.min(gross, bhtnBaseCap);

    // 2. Calculate Insurance
    const bhxh = salaryForBHXH * CONFIG_2026.INSURANCE.BHXH;
    const bhyt = salaryForBHXH * CONFIG_2026.INSURANCE.BHYT;
    const bhtn = salaryForBHTN * CONFIG_2026.INSURANCE.BHTN;
    const totalInsurance = bhxh + bhyt + bhtn;

    // 3. Income Before Tax
    const incomeBeforeTax = gross - totalInsurance;

    // 4. Taxable Income
    const totalDeduction = CONFIG_2026.DEDUCTIONS.PERSONAL + (dependents * CONFIG_2026.DEDUCTIONS.DEPENDENT);
    const taxableIncome = Math.max(0, incomeBeforeTax - totalDeduction);

    // 5. PIT
    const pit = calculatePIT(taxableIncome);

    // 6. Net
    const net = incomeBeforeTax - pit;

    return {
        gross,
        bhxh,
        bhyt,
        bhtn,
        totalInsurance,
        incomeBeforeTax,
        personalDeduction: CONFIG_2026.DEDUCTIONS.PERSONAL,
        dependentDeduction: dependents * CONFIG_2026.DEDUCTIONS.DEPENDENT,
        taxableIncome,
        pit,
        net
    };
}

function calculateNetToGross(targetNet, dependents, region) {
    let currentGross = targetNet;
    let iterations = 0;
    const maxIterations = 100;
    const tolerance = 1;

    // Initial guess: Add back basic deductions/insurance roughly
    // Just start with Net and climb up.

    while (iterations < maxIterations) {
        const result = calculateGrossToNet(currentGross, dependents, region);
        const diff = targetNet - result.net;

        if (Math.abs(diff) < tolerance) {
            return result;
        }

        // Adjustment strategy: Add the difference directly.
        // Since Tax/Insurance reduces gross, adding the diff is a safe step up.
        // For higher brackets, we might need to boost it slightly more (diff / (1 - rate)),
        // but simple addition converges fast enough for monotonic functions.
        currentGross += diff;
        iterations++;
    }

    return calculateGrossToNet(currentGross, dependents, region);
}

// UI Handling
document.addEventListener('DOMContentLoaded', () => {
    const incomeInput = document.getElementById('income');
    const dependentsInput = document.getElementById('dependents');
    const regionSelect = document.getElementById('region');
    const calculateBtn = document.getElementById('calculate-btn');
    const resultSection = document.getElementById('result-section');
    const radioGrossToNet = document.getElementById('gross-to-net');
    const radioNetToGross = document.getElementById('net-to-gross');

    // Format input with commas
    incomeInput.addEventListener('input', (e) => {
        let value = e.target.value.replace(/[^0-9]/g, '');
        if (value) {
            e.target.value = parseInt(value).toLocaleString('en-US');
        } else {
            e.target.value = '';
        }
    });

    calculateBtn.addEventListener('click', () => {
        const incomeRaw = incomeInput.value.replace(/,/g, '');
        const income = parseFloat(incomeRaw) || 0;
        const dependents = parseInt(dependentsInput.value) || 0;
        const region = parseInt(regionSelect.value);
        const isNetToGross = radioNetToGross.checked;

        let result;
        if (isNetToGross) {
            result = calculateNetToGross(income, dependents, region);
        } else {
            result = calculateGrossToNet(income, dependents, region);
        }

        displayResult(result);
    });

    function displayResult(res) {
        document.getElementById('res-gross').innerText = formatCurrency(res.gross);
        document.getElementById('res-social').innerText = '-' + formatCurrency(res.bhxh);
        document.getElementById('res-health').innerText = '-' + formatCurrency(res.bhyt);
        document.getElementById('res-unemp').innerText = '-' + formatCurrency(res.bhtn);
        document.getElementById('res-income-before-tax').innerText = formatCurrency(res.incomeBeforeTax);
        document.getElementById('res-personal-ded').innerText = '-' + formatCurrency(res.personalDeduction);
        document.getElementById('res-dependent-ded').innerText = '-' + formatCurrency(res.dependentDeduction);
        document.getElementById('res-taxable').innerText = formatCurrency(res.taxableIncome);
        document.getElementById('res-pit').innerText = '-' + formatCurrency(res.pit);
        document.getElementById('res-net').innerText = formatCurrency(res.net);

        resultSection.style.display = 'block';
        resultSection.scrollIntoView({ behavior: 'smooth' });
    }
});

// Test Cases for Verification
function runTests() {
    console.log("Running Tests...");

    // Test Case 1: Gross 10M, Region I, 0 Dep
    // BHXH (8%) = 800k
    // BHYT (1.5%) = 150k
    // BHTN (1%) = 100k
    // Total Ins = 1.05M
    // Income Before Tax = 8.95M
    // Taxable = 8.95M - 15.5M = 0
    // PIT = 0
    // Net = 8.95M
    const test1 = calculateGrossToNet(10000000, 0, 1);
    console.log("Test Case 1 (Gross 10M):", test1.net === 8950000 ? "PASS" : "FAIL", test1.net);

    // Test Case 2: Net to Gross check
    // If Net is 8.95M, Gross should be 10M
    const test2 = calculateNetToGross(8950000, 0, 1);
    console.log("Test Case 2 (Net 8.95M -> Gross):", Math.abs(test2.gross - 10000000) < 5 ? "PASS" : "FAIL", test2.gross);
}

// Uncomment to run tests in browser console
// runTests();
