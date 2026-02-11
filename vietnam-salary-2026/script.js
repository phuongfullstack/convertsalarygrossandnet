/**
 * Vietnam Salary Converter 2026
 * Compliant with Law 109/2025/QH15
 */

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
    EMPLOYER_INSURANCE: {
        BHXH: 0.175,
        BHYT: 0.03,
        BHTN: 0.01,
        // UNION: 0.02 // Optional/Often separate
    },
    DEDUCTIONS: {
        PERSONAL: 15500000,
        DEPENDENT: 6200000
    },
    TAX_BRACKETS: [
        { id: 1, max: 10000000, rate: 0.05, subtract: 0, label: "5%" },
        { id: 2, max: 30000000, rate: 0.10, subtract: 500000, label: "10%" },
        { id: 3, max: 60000000, rate: 0.20, subtract: 3500000, label: "20%" },
        { id: 4, max: 100000000, rate: 0.30, subtract: 9500000, label: "30%" },
        { id: 5, max: Infinity, rate: 0.35, subtract: 14500000, label: "35%" }
    ]
};

// State
let appState = {
    salary: 35000000,
    dependents: 0,
    region: 1,
    isNetToGross: false,
    isExpat: false,
    isProbation: false
};

// Utilities
function formatCurrency(amount) {
    return new Intl.NumberFormat('vi-VN').format(Math.round(amount));
}

function parseCurrency(str) {
    if (typeof str !== 'string') return str;
    return parseInt(str.replace(/[^0-9]/g, '')) || 0;
}

// Core Logic
function calculatePIT(taxableIncome) {
    if (taxableIncome <= 0) return { tax: 0, bracket: 0, details: [] };

    let tax = 0;
    let bracketIndex = 0;
    let details = [];

    // Find the applicable bracket for the total taxable income
    for (let i = 0; i < CONFIG_2026.TAX_BRACKETS.length; i++) {
        const b = CONFIG_2026.TAX_BRACKETS[i];
        if (taxableIncome <= b.max) {
            tax = taxableIncome * b.rate - b.subtract;
            bracketIndex = i + 1;
            break;
        }
    }
    // Handle top bracket
    if (taxableIncome > 100000000) {
        const b = CONFIG_2026.TAX_BRACKETS[4];
        tax = taxableIncome * b.rate - b.subtract;
        bracketIndex = 5;
    }

    // Generate progressive calculation details
    let remainingIncome = taxableIncome;
    let previousMax = 0;

    for (let i = 0; i < bracketIndex; i++) {
        const b = CONFIG_2026.TAX_BRACKETS[i];
        const rangeMax = b.max === Infinity ? taxableIncome : b.max;

        // Calculate the chunk of income in this bracket
        const currentBracketMax = b.max === Infinity ? taxableIncome : b.max;
        const incomeInBracket = Math.min(taxableIncome, currentBracketMax) - previousMax;

        if (incomeInBracket > 0) {
            details.push({
                tier: i + 1,
                rate: b.rate * 100,
                income: incomeInBracket,
                tax: incomeInBracket * b.rate
            });
        }
        previousMax = b.max;
    }

    return { tax, bracket: bracketIndex, details };
}

function calculateGrossToNet(gross, dependents, region, isExpat, isProbation) {
    // 0. Probation Check
    if (isProbation) {
        const pit = gross >= 2000000 ? gross * 0.1 : 0;
        const net = gross - pit;
        return {
            gross,
            bhxh: 0, bhyt: 0, bhtn: 0,
            totalInsurance: 0,
            incomeBeforeTax: gross,
            personalDeduction: 0,
            dependentDeduction: 0,
            taxableIncome: gross,
            pit,
            net,
            bracket: 0,
            taxDetails: [],
            employerCost: gross
        };
    }

    // 1. Insurance Bases
    const bhxhBaseCap = 20 * CONFIG_2026.BASE_SALARY;
    const bhtnBaseCap = 20 * CONFIG_2026.REGIONAL_MIN_WAGE[region];

    const salaryForBHXH = Math.min(gross, bhxhBaseCap);
    const salaryForBHTN = Math.min(gross, bhtnBaseCap);

    // 2. Employee Insurance
    // Expat: No BHTN
    const bhxhRate = CONFIG_2026.INSURANCE.BHXH;
    const bhytRate = CONFIG_2026.INSURANCE.BHYT;
    const bhtnRate = isExpat ? 0 : CONFIG_2026.INSURANCE.BHTN;

    const bhxh = salaryForBHXH * bhxhRate;
    const bhyt = salaryForBHXH * bhytRate;
    const bhtn = salaryForBHTN * bhtnRate;
    const totalInsurance = bhxh + bhyt + bhtn;

    // 3. Employer Cost
    const empBhxh = salaryForBHXH * CONFIG_2026.EMPLOYER_INSURANCE.BHXH;
    const empBhyt = salaryForBHXH * CONFIG_2026.EMPLOYER_INSURANCE.BHYT;
    const empBhtn = isExpat ? 0 : (salaryForBHTN * CONFIG_2026.EMPLOYER_INSURANCE.BHTN);
    const employerCost = gross + empBhxh + empBhyt + empBhtn;

    // 4. Income Before Tax
    const incomeBeforeTax = gross - totalInsurance;

    // 5. Taxable Income
    const personalDed = CONFIG_2026.DEDUCTIONS.PERSONAL;
    const dependentDed = dependents * CONFIG_2026.DEDUCTIONS.DEPENDENT;
    const totalDeduction = personalDed + dependentDed;

    const taxableIncome = Math.max(0, incomeBeforeTax - totalDeduction);

    // 6. PIT
    const pitResult = calculatePIT(taxableIncome);

    // 7. Net
    const net = incomeBeforeTax - pitResult.tax;

    return {
        gross,
        bhxh,
        bhyt,
        bhtn,
        totalInsurance,
        incomeBeforeTax,
        personalDeduction: personalDed,
        dependentDeduction: dependentDed,
        taxableIncome,
        pit: pitResult.tax,
        net,
        bracket: pitResult.bracket,
        taxDetails: pitResult.details,
        employerCost
    };
}

function calculateNetToGross(targetNet, dependents, region, isExpat, isProbation) {
    // Iterative Solver
    let currentGross = targetNet;
    let iterations = 0;
    const maxIterations = 50;
    const tolerance = 5; // 5 VND

    // Initial guess
    currentGross = targetNet * 1.1;

    while (iterations < maxIterations) {
        const res = calculateGrossToNet(currentGross, dependents, region, isExpat, isProbation);
        const diff = targetNet - res.net;

        if (Math.abs(diff) < tolerance) {
            return res;
        }

        currentGross += diff;
        iterations++;
    }

    return calculateGrossToNet(currentGross, dependents, region, isExpat, isProbation);
}

// UI Binding
document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const inputSalary = document.getElementById('salary-input');
    const inputDep = document.getElementById('dependents-input');
    const btnDepMinus = document.getElementById('dep-minus');
    const btnDepPlus = document.getElementById('dep-plus');
    const regionBtns = document.querySelectorAll('.region-btn');
    const toggleExpat = document.getElementById('expat-toggle');
    const toggleProbation = document.getElementById('probation-toggle');
    const btnCalculate = document.getElementById('calc-btn');
    const tabGross = document.getElementById('tab-gross-net');
    const tabNet = document.getElementById('tab-net-gross');

    // Outputs
    const outNet = document.getElementById('net-result');
    const outGross = document.getElementById('detail-gross');
    const outBhxh = document.getElementById('detail-bhxh');
    const outBhyt = document.getElementById('detail-bhyt');
    const outBhtn = document.getElementById('detail-bhtn');
    const outPreTax = document.getElementById('detail-pretax');
    const outPersDed = document.getElementById('detail-personal');
    const outDepDed = document.getElementById('detail-dependent');
    const outTaxable = document.getElementById('detail-taxable');
    const outTax = document.getElementById('detail-tax');
    const outTaxLevel = document.getElementById('detail-tax-level');
    const outTotalTax = document.getElementById('detail-total-tax');
    const outEmployerCost = document.getElementById('employer-cost');
    const regionNote = document.getElementById('region-note');
    const taxContent = document.getElementById('tax-details-content');

    // Chart & Slider
    const chartEl = document.getElementById('salary-chart');
    const netPercentEl = document.getElementById('net-percent');
    const sliderFill = document.getElementById('bracket-fill');
    const bracketNote = document.getElementById('bracket-note');
    const bracketBadge = document.getElementById('tax-bracket-badge');
    const sliderDots = document.querySelectorAll('.slider-dots .dot');

    // Event Listeners
    inputSalary.addEventListener('input', (e) => {
        let val = e.target.value.replace(/[^0-9]/g, '');
        if (val) {
            e.target.value = parseInt(val).toLocaleString('en-US');
            appState.salary = parseInt(val);
        } else {
            appState.salary = 0;
        }
    });

    // Initial Format
    inputSalary.value = appState.salary.toLocaleString('en-US');

    // Dependents
    btnDepMinus.addEventListener('click', () => {
        let val = parseInt(inputDep.value) || 0;
        if (val > 0) {
            inputDep.value = val - 1;
            appState.dependents = val - 1;
            document.getElementById('detail-dep-count').innerText = (val - 1) + " người";
            document.getElementById('detail-dep-count').parentElement.querySelector('.green').innerText =
                formatCurrency((val-1) * CONFIG_2026.DEDUCTIONS.DEPENDENT);
        }
    });
    btnDepPlus.addEventListener('click', () => {
        let val = parseInt(inputDep.value) || 0;
        inputDep.value = val + 1;
        appState.dependents = val + 1;
        document.getElementById('detail-dep-count').innerText = (val + 1) + " người";
        document.getElementById('detail-dep-count').parentElement.querySelector('.green').innerText =
                formatCurrency((val+1) * CONFIG_2026.DEDUCTIONS.DEPENDENT);
    });

    // Region
    regionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            regionBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            appState.region = parseInt(btn.dataset.region);

            // Update Note
            const minWage = CONFIG_2026.REGIONAL_MIN_WAGE[appState.region];
            const roman = {1:'I', 2:'II', 3:'III', 4:'IV'}[appState.region];
            regionNote.innerText = `Vùng ${roman}: ${formatCurrency(minWage)}đ`;
        });
    });

    // Tabs
    tabGross.addEventListener('click', () => {
        tabGross.classList.add('active');
        tabNet.classList.remove('active');
        appState.isNetToGross = false;
        // Update input label if needed
        document.querySelector('.form-group label').innerText = "Lương Gross (VND)";
    });
    tabNet.addEventListener('click', () => {
        tabNet.classList.add('active');
        tabGross.classList.remove('active');
        appState.isNetToGross = true;
        document.querySelector('.form-group label').innerText = "Lương Net mong muốn (VND)";
    });

    // Toggles
    toggleExpat.addEventListener('change', (e) => {
        appState.isExpat = e.target.checked;
        if(appState.isExpat) {
            document.getElementById('detail-bhtn-rate').innerText = "0% (Expat)";
        } else {
            document.getElementById('detail-bhtn-rate').innerText = "1% (Vùng " + {1:'I', 2:'II', 3:'III', 4:'IV'}[appState.region] + ")";
        }
    });
    toggleProbation.addEventListener('change', (e) => appState.isProbation = e.target.checked);

    // Collapsible
    const toggleBtn = document.getElementById('toggle-tax-details');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', function() {
            const content = document.getElementById('tax-details-content');
            content.classList.toggle('open');
            const svg = this.querySelector('svg');
            if (svg) {
                svg.style.transform = content.classList.contains('open') ? 'rotate(180deg)' : 'rotate(0deg)';
            }
        });
    }

    // Calculate
    btnCalculate.addEventListener('click', performCalculation);

    function performCalculation() {
        let result;
        if (appState.isNetToGross) {
            result = calculateNetToGross(appState.salary, appState.dependents, appState.region, appState.isExpat, appState.isProbation);
        } else {
            result = calculateGrossToNet(appState.salary, appState.dependents, appState.region, appState.isExpat, appState.isProbation);
        }

        renderResults(result);
    }

    function renderResults(res) {
        // Table
        outGross.innerText = formatCurrency(res.gross);
        outBhxh.innerText = res.bhxh ? `-${formatCurrency(res.bhxh)}` : '0';
        outBhyt.innerText = res.bhyt ? `-${formatCurrency(res.bhyt)}` : '0';
        outBhtn.innerText = res.bhtn ? `-${formatCurrency(res.bhtn)}` : '0';
        outPreTax.innerText = formatCurrency(res.incomeBeforeTax);
        outPersDed.innerText = `-${formatCurrency(res.personalDeduction)}`;
        outDepDed.innerText = `-${formatCurrency(res.dependentDeduction)}`;
        outTaxable.innerText = formatCurrency(res.taxableIncome);
        outTax.innerText = `-${formatCurrency(res.pit)}`;
        outNet.innerText = formatCurrency(res.net);
        outEmployerCost.innerText = `${formatCurrency(res.employerCost)} VND`;

        // Tax Level
        outTaxLevel.innerText = res.bracket > 0 ? `Bậc ${res.bracket}` : '-';
        bracketBadge.innerText = res.bracket > 0 ? `Bậc ${res.bracket}/5` : 'Miễn thuế';

        // Chart
        // Calculate safe percentages (avoid NaN)
        const gross = res.gross || 1;
        const netP = (res.net / gross) * 100;
        const insP = (res.totalInsurance / gross) * 100;
        const taxP = (res.pit / gross) * 100;

        // CSS conic gradient: Net (0 to netP), Ins (netP to netP+insP), Tax (netP+insP to 100)
        chartEl.style.setProperty('--net-p', `${netP}%`);
        chartEl.style.setProperty('--ins-end', `${netP + insP}%`);
        netPercentEl.innerText = `${Math.round(netP)}%`;

        // Slider
        const sliderWidth = Math.min(100, (res.bracket / 5) * 100);
        sliderFill.style.width = `${sliderWidth}%`;

        // Dots
        sliderDots.forEach((dot, idx) => {
            if (idx < res.bracket) {
                dot.classList.add('active'); // Past brackets
            } else {
                dot.classList.remove('active');
            }
            if (idx === res.bracket - 1) {
                dot.classList.add('filled'); // Current bracket
            } else {
                dot.classList.remove('filled');
            }
        });

        // Bracket Note
        if (res.bracket > 0) {
            const b = CONFIG_2026.TAX_BRACKETS[res.bracket - 1];
            const prev = res.bracket === 1 ? 0 : CONFIG_2026.TAX_BRACKETS[res.bracket - 2].max;
            const maxStr = b.max === Infinity ? 'trở lên' : `${formatCurrency(b.max)}`;
            bracketNote.innerText = `Thu nhập tính thuế từ ${formatCurrency(prev)} đến ${maxStr} VND.`;
        } else {
            bracketNote.innerText = "Chưa đến mức phải đóng thuế TNCN.";
        }

        // Detailed Tax Breakdown
        if (taxContent) {
            taxContent.innerHTML = '';
            if (res.taxDetails.length > 0) {
                res.taxDetails.forEach(d => {
                    const row = document.createElement('div');
                    row.className = 'd-row sub-item';
                    row.innerHTML = `
                        <span>Bậc ${d.tier} (${d.rate}%)</span>
                        <span>${formatCurrency(d.income)} x ${d.rate}%</span>
                        <span>${formatCurrency(d.tax)}</span>
                    `;
                    taxContent.appendChild(row);
                });
            } else {
                taxContent.innerHTML = '<div style="padding:8px; text-align:center;">Không có thuế phát sinh.</div>';
            }
        }
        outTotalTax.innerText = formatCurrency(res.pit);
    }

    // Initial Run
    performCalculation();
});
