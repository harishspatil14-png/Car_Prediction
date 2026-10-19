const STORAGE_KEY = "carwise.predictionRecords";
const navigationButtons = document.querySelectorAll(".nav-link");
const views = {
    dashboard: document.getElementById("dashboardView"),
    prediction: document.getElementById("predictionView"),
    records: document.getElementById("recordsView")
};
const pageTitles = {
    dashboard: "Dashboard",
    prediction: "New prediction",
    records: "Prediction records"
};
const resultCard = document.getElementById("resultCard");
const resultAmount = document.getElementById("resultAmount");
const resultNote = document.getElementById("resultNote");
const resultVehicle = document.getElementById("resultVehicle");
const recordsTableBody = document.getElementById("recordsTableBody");
const emptyRecords = document.getElementById("emptyRecords");
const recordsSummary = document.getElementById("recordsSummary");
const recordsTotal = document.getElementById("recordsTotal");
const clearRecordsButton = document.getElementById("clearRecords");
const downloadRecordsButton = document.getElementById("downloadRecords");
const predictionForm = document.getElementById("predictForm");
const clearPredictionFormButton = document.getElementById("clearPredictionForm");
const companyInput = document.getElementById("company");
const companySuggestionsList = document.getElementById("companySuggestionsList");
const carNameInput = document.getElementById("car_name");
const carNameSuggestions = document.getElementById("carNameSuggestions");
const yearInput = document.getElementById("year");
const yearSuggestionsList = document.getElementById("yearSuggestionsList");
const kilometerInput = document.getElementById("kms_driven");
const kilometerSuggestionsList = document.getElementById("kilometerSuggestionsList");
const dashboardData = JSON.parse(document.getElementById("dashboardData").textContent);
const yearSuggestions = Array.from(document.querySelectorAll("#yearSuggestions option")).map((option) => option.value);
const kilometerSuggestions = Array.from(document.querySelectorAll("#kilometerSuggestions option")).map((option) => option.value);
let records = [];
let storageError = "";
let activeHowSlide = 0;
let companyNamesRequest;
const modelNamesByCompany = new Map();
const modelRequestsByCompany = new Map();

const howSlides = [
    {
        title: "Add the car details",
        copy: "Choose the company, car name, year, mileage, and fuel type to describe the vehicle."
    },
    {
        title: "Get a data-based estimate",
        copy: "The model compares those details with patterns learned from the cars in the training dataset."
    },
    {
        title: "Keep track of predictions",
        copy: "Your estimates are saved in this browser, so you can revisit or remove them whenever you like."
    }
];
const fuelColors = {
    Petrol: "#7163dd",
    Diesel: "#47a986",
    LPG: "#eca957"
};

const currencyFormatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
});
const numberFormatter = new Intl.NumberFormat("en-IN");

function formatCurrency(value) {
    return currencyFormatter.format(Number(value));
}

function formatNumber(value) {
    return numberFormatter.format(Number(value));
}

async function fetchJson(url) {
    const response = await fetch(url);
    const result = await response.json();
    if (!response.ok) {
        throw new Error(result.error || "Could not load dropdown options.");
    }
    return result;
}

async function getCompanyNames() {
    if (!companyNamesRequest) {
        companyNamesRequest = fetchJson("/api/companies")
            .then((result) => result.companies);
    }
    const request = companyNamesRequest;
    try {
        return await request;
    } catch (error) {
        if (companyNamesRequest === request) {
            companyNamesRequest = null;
        }
        throw error;
    }
}

async function getModelNames(company) {
    const key = company.toLocaleLowerCase();
    if (modelNamesByCompany.has(key)) {
        return modelNamesByCompany.get(key);
    }
    if (!modelRequestsByCompany.has(key)) {
        const request = fetchJson(`/api/models?company=${encodeURIComponent(company)}`)
            .then((result) => {
                modelNamesByCompany.set(key, result.models);
                return result.models;
            });
        modelRequestsByCompany.set(key, request);
    }
    const request = modelRequestsByCompany.get(key);
    try {
        return await request;
    } finally {
        if (modelRequestsByCompany.get(key) === request) {
            modelRequestsByCompany.delete(key);
        }
    }
}

async function getCarModelNames() {
    const company = companyInput.value.trim();
    if (!company) {
        return [];
    }
    const companies = await getCompanyNames();
    const matchedCompany = companies.find(
        (name) => name.toLocaleLowerCase() === company.toLocaleLowerCase()
    );
    return matchedCompany ? getModelNames(matchedCompany) : [];
}

async function updateCarNameSuggestions() {
    carNameInput.value = "";
    carNameSuggestions.hidden = true;
    try {
        await getCarModelNames();
        if (document.activeElement === carNameInput) {
            carNameInput.dispatchEvent(new Event("input"));
        }
    } catch (error) {
        if (document.activeElement === companyInput) {
            renderDropdownMessage(
                companySuggestionsList,
                `Could not load companies or models: ${error.message}`
            );
            companyInput.setAttribute("aria-expanded", "true");
        }
    }
}

function renderDropdownMessage(suggestionList, message) {
    suggestionList.replaceChildren();
    const notice = document.createElement("div");
    notice.className = "autocomplete-message";
    notice.setAttribute("role", "status");
    notice.textContent = message;
    suggestionList.appendChild(notice);
    suggestionList.hidden = false;
}

function setupAutocomplete(inputElement, suggestionList, getValues) {
    let renderRequest = 0;
    const setExpanded = (expanded) => {
        inputElement.setAttribute("aria-expanded", String(expanded));
    };
    const renderSuggestions = async () => {
        const currentRequest = ++renderRequest;
        const query = inputElement.value.trim().toLowerCase();
        let values;
        try {
            values = await getValues();
        } catch (error) {
            if (currentRequest !== renderRequest) {
                return;
            }
            renderDropdownMessage(suggestionList, `Could not load options: ${error.message}`);
            setExpanded(true);
            return;
        }

        if (currentRequest !== renderRequest) {
            return;
        }
        const filteredValues = query
            ? values.filter((value) => String(value).toLowerCase().includes(query))
            : values;

        suggestionList.replaceChildren();
        if (!filteredValues.length) {
            suggestionList.hidden = true;
            setExpanded(false);
            return;
        }
        filteredValues.forEach((value) => {
            const option = document.createElement("button");
            option.type = "button";
            option.className = "autocomplete-option";
            option.setAttribute("role", "option");
            option.setAttribute("aria-selected", "false");
            option.dataset.value = value;
            option.textContent = value;
            option.addEventListener("mousedown", (event) => {
                event.preventDefault();
                inputElement.value = value;
                suggestionList.hidden = true;
                setExpanded(false);
                inputElement.focus();
                inputElement.dispatchEvent(new Event("change", { bubbles: true }));
            });
            suggestionList.appendChild(option);
        });
        suggestionList.hidden = false;
        setExpanded(true);
    };

    inputElement.addEventListener("focus", renderSuggestions);
    inputElement.addEventListener("input", renderSuggestions);
    inputElement.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            suggestionList.hidden = true;
            setExpanded(false);
            return;
        }

        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
            return;
        }

        const options = [...suggestionList.querySelectorAll(".autocomplete-option")];
        if (!options.length) {
            return;
        }

        event.preventDefault();
        const currentIndex = options.findIndex((option) => option.classList.contains("active"));
        let nextIndex = 0;

        if (currentIndex >= 0) {
            options[currentIndex].classList.remove("active");
            options[currentIndex].setAttribute("aria-selected", "false");
            nextIndex = event.key === "ArrowDown" ? currentIndex + 1 : currentIndex - 1;
        } else if (event.key === "ArrowDown") {
            nextIndex = 0;
        } else {
            nextIndex = options.length - 1;
        }

        const boundedIndex = Math.min(Math.max(nextIndex, 0), options.length - 1);
        const selectedOption = options[boundedIndex];
        selectedOption.classList.add("active");
        selectedOption.setAttribute("aria-selected", "true");
        selectedOption.scrollIntoView({ block: "nearest" });
    });

    inputElement.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
            return;
        }

        const activeOption = suggestionList.querySelector(".autocomplete-option.active");
        const firstOption = suggestionList.querySelector(".autocomplete-option");
        const selected = activeOption || firstOption;
        if (!selected) {
            return;
        }

        event.preventDefault();
        inputElement.value = selected.dataset.value;
        suggestionList.hidden = true;
        setExpanded(false);
        inputElement.dispatchEvent(new Event("change", { bubbles: true }));
    });

    inputElement.addEventListener("blur", () => {
        window.setTimeout(() => {
            suggestionList.hidden = true;
            setExpanded(false);
            suggestionList.querySelectorAll(".autocomplete-option").forEach((option) => option.classList.remove("active"));
        }, 120);
    });

    inputElement.addEventListener("input", renderSuggestions);
}

function renderHowSlide() {
    const slide = howSlides[activeHowSlide];
    document.getElementById("howSlideIndex").textContent = `${String(activeHowSlide + 1).padStart(2, "0")} / 03`;
    document.getElementById("howSlideNumber").textContent = String(activeHowSlide + 1).padStart(2, "0");
    document.getElementById("howSlideTitle").textContent = slide.title;
    document.getElementById("howSlideCopy").textContent = slide.copy;
    document.querySelectorAll(".carousel-dot").forEach((dot, index) => {
        const isActive = index === activeHowSlide;
        dot.classList.toggle("active", isActive);
        if (isActive) {
            dot.setAttribute("aria-current", "true");
        } else {
            dot.removeAttribute("aria-current");
        }
    });
}

function renderCompanyVariants(company) {
    const variants = dashboardData.company_variants[company];
    const variantSummary = document.getElementById("variantSummary");
    const variantList = document.getElementById("variantList");
    variantSummary.textContent = `${company} has ${formatNumber(variants.length)} ${variants.length === 1 ? "variant" : "variants"} in the dataset.`;
    variantList.replaceChildren();

    variants.forEach((variant) => {
        const item = document.createElement("span");
        item.className = "variant-chip";
        item.textContent = variant;
        variantList.appendChild(item);
    });
}

function renderFuelChart() {
    const entries = Object.entries(dashboardData.fuel_counts);
    const total = entries.reduce((sum, [, count]) => sum + count, 0);
    let angle = 0;
    const stops = entries.map(([fuelType, count]) => {
        const endAngle = angle + (count / total) * 360;
        const stop = `${fuelColors[fuelType] || "#9a9dac"} ${angle}deg ${endAngle}deg`;
        angle = endAngle;
        return stop;
    });
    const chart = document.getElementById("fuelPieChart");
    chart.style.background = `conic-gradient(${stops.join(", ")})`;
    chart.setAttribute(
        "aria-label",
        entries.map(([fuelType, count]) => `${fuelType}: ${formatNumber(count)} cars`).join(", ")
    );
    const totalLabel = document.getElementById("fuelPieTotal");
    totalLabel.replaceChildren(document.createTextNode(formatNumber(total)));
    const totalUnit = document.createElement("small");
    totalUnit.textContent = "cars";
    totalLabel.appendChild(totalUnit);

    const legend = document.getElementById("fuelLegend");
    legend.replaceChildren();
    entries.forEach(([fuelType, count]) => {
        const item = document.createElement("div");
        const label = document.createElement("span");
        const marker = document.createElement("span");
        const value = document.createElement("strong");
        item.className = "fuel-legend-item";
        label.className = "fuel-legend-label";
        marker.className = "fuel-legend-marker";
        marker.style.backgroundColor = fuelColors[fuelType] || "#9a9dac";
        marker.setAttribute("aria-hidden", "true");
        label.append(marker, document.createTextNode(fuelType));
        value.textContent = `${formatNumber(count)} · ${((count / total) * 100).toFixed(1)}%`;
        item.append(label, value);
        legend.appendChild(item);
    });
}

function resetPredictionForm() {
    predictionForm.reset();
    companySuggestionsList.hidden = true;
    carNameSuggestions.hidden = true;
    yearSuggestionsList.hidden = true;
    kilometerSuggestionsList.hidden = true;
    [companyInput, carNameInput, yearInput, kilometerInput].forEach((input) => {
        input.setAttribute("aria-expanded", "false");
    });
    updateCarNameSuggestions();
    resultCard.hidden = true;
    resultAmount.textContent = "";
    resultNote.textContent = "";
    resultVehicle.textContent = "";
    const submitButton = predictionForm.querySelector('button[type="submit"]');
    submitButton.disabled = false;
    submitButton.querySelector("span").textContent = "Get estimate";
}

function showView(name) {
    if (name === "prediction") {
        resetPredictionForm();
    }

    Object.entries(views).forEach(([viewName, view]) => {
        const isActive = viewName === name;
        view.hidden = !isActive;
        view.classList.toggle("active", isActive);
    });

    navigationButtons.forEach((button) => {
        const isActive = button.dataset.view === name;
        button.classList.toggle("active", isActive);
        if (isActive) {
            button.setAttribute("aria-current", "page");
        } else {
            button.removeAttribute("aria-current");
        }
    });

    document.getElementById("pageTitle").textContent = pageTitles[name];
    if (name === "records") {
        renderRecords();
    }
}

function readRecords() {
    const storedRecords = window.localStorage.getItem(STORAGE_KEY);
    if (storedRecords === null) {
        return [];
    }

    const parsedRecords = JSON.parse(storedRecords);
    if (!Array.isArray(parsedRecords) || parsedRecords.some((record) => !record || typeof record !== "object")) {
        throw new Error("Saved prediction history has an unexpected format.");
    }
    const cleanedRecords = parsedRecords.map((record) => {
        const cleanedRecord = {...record};
        delete cleanedRecord.asking_price;
        return cleanedRecord;
    });
    if (cleanedRecords.some((record, index) => Object.keys(record).length !== Object.keys(parsedRecords[index]).length)) {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanedRecords));
        } catch (error) {
            storageError = error.message;
        }
    }
    return cleanedRecords;
}

function saveRecords() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    storageError = "";
}

function addCell(row, value, className) {
    const cell = document.createElement("td");
    if (className) {
        cell.className = className;
    }
    cell.textContent = value;
    row.appendChild(cell);
    return cell;
}

function renderRecords() {
    recordsTableBody.replaceChildren();

    records.forEach((record) => {
        const row = document.createElement("tr");
        const vehicleCell = document.createElement("td");
        const vehicle = document.createElement("div");
        const icon = document.createElement("span");
        const vehicleName = document.createElement("span");
        const companyName = document.createElement("span");

        vehicle.className = "vehicle-cell";
        icon.className = "vehicle-avatar";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = "↗";
        vehicleName.textContent = record.car_name;
        companyName.textContent = ` · ${record.company}`;
        companyName.className = "vehicle-company";
        vehicleName.appendChild(companyName);
        vehicle.append(icon, vehicleName);
        vehicleCell.appendChild(vehicle);
        row.appendChild(vehicleCell);

        addCell(row, String(record.year));
        addCell(row, `${formatNumber(record.kms_driven)} km`);
        addCell(row, formatCurrency(record.predicted_price), "table-amount");
        addCell(row, new Date(record.created_at).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric"
        }));

        const actionCell = document.createElement("td");
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "delete-record";
        deleteButton.dataset.recordId = record.id;
        deleteButton.setAttribute("aria-label", `Delete ${record.car_name} prediction`);
        deleteButton.title = "Delete prediction";
        deleteButton.textContent = "×";
        actionCell.appendChild(deleteButton);
        row.appendChild(actionCell);
        recordsTableBody.appendChild(row);
    });

    const hasRecords = records.length > 0;
    emptyRecords.hidden = hasRecords;
    recordsTableBody.closest("table").hidden = !hasRecords;
    clearRecordsButton.hidden = !hasRecords;
    downloadRecordsButton.hidden = !hasRecords;
    recordsTotal.textContent = `${records.length} ${records.length === 1 ? "record" : "records"}`;
    recordsSummary.textContent = storageError
        ? `History is unavailable: ${storageError}`
        : hasRecords
            ? "Your estimates, saved on this device."
            : "Your saved estimates will appear here.";

    document.getElementById("navRecordCount").textContent = String(records.length);
}

document.getElementById("previousHowSlide").addEventListener("click", () => {
    activeHowSlide = (activeHowSlide + howSlides.length - 1) % howSlides.length;
    renderHowSlide();
});
document.getElementById("nextHowSlide").addEventListener("click", () => {
    activeHowSlide = (activeHowSlide + 1) % howSlides.length;
    renderHowSlide();
});
document.querySelectorAll(".carousel-dot").forEach((dot) => {
    dot.addEventListener("click", () => {
        activeHowSlide = Number(dot.dataset.slide);
        renderHowSlide();
    });
});

const companyFilter = document.getElementById("companyFilter");
companyFilter.addEventListener("change", () => renderCompanyVariants(companyFilter.value));
companyInput.addEventListener("input", updateCarNameSuggestions);
companyInput.addEventListener("change", updateCarNameSuggestions);
setupAutocomplete(companyInput, companySuggestionsList, getCompanyNames);
setupAutocomplete(carNameInput, carNameSuggestions, getCarModelNames);
setupAutocomplete(yearInput, yearSuggestionsList, () => yearSuggestions);
setupAutocomplete(kilometerInput, kilometerSuggestionsList, () => kilometerSuggestions);
renderHowSlide();
renderCompanyVariants(companyFilter.value);
renderFuelChart();
clearPredictionFormButton.addEventListener("click", resetPredictionForm);
downloadRecordsButton.addEventListener("click", async () => {
    downloadRecordsButton.disabled = true;
    try {
        const response = await fetch("/download-records", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(records)
        });
        if (!response.ok) {
            const result = await response.json();
            throw new Error(result.error || "Could not create the records PDF.");
        }

        const pdf = await response.blob();
        const downloadUrl = URL.createObjectURL(pdf);
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = "carwise-prediction-records.pdf";
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } catch (error) {
        window.alert(`PDF download failed: ${error.message}`);
    } finally {
        downloadRecordsButton.disabled = false;
    }
});

navigationButtons.forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
});

document.querySelectorAll("[data-open-view]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.openView));
});

document.getElementById("predictForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const data = {
        car_name: String(formData.get("car_name")).trim(),
        company: String(formData.get("company")).trim(),
        year: String(formData.get("year")),
        kms_driven: String(formData.get("kms_driven")),
        fuel_type: String(formData.get("fuel_type")).trim()
    };
    const submitButton = form.querySelector('button[type="submit"]');
    const submitLabel = submitButton.querySelector("span");
    submitButton.disabled = true;
    submitLabel.textContent = "Calculating…";
    resultCard.hidden = true;

    try {
        const response = await fetch("/predict", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || "Prediction failed.");
        }

        const record = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            ...data,
            year: Number(data.year),
            kms_driven: Number(data.kms_driven),
            predicted_price: Number(result.predicted_price),
            created_at: new Date().toISOString()
        };

        resultAmount.textContent = formatCurrency(record.predicted_price);
        resultVehicle.textContent = `${record.company} ${record.car_name} · ${record.year}`;
        resultNote.textContent = "";

        records = [record, ...records];
        try {
            saveRecords();
        } catch (error) {
            storageError = error.message;
            resultNote.textContent = "This estimate could not be saved to browser history.";
        }
        renderRecords();
        resultCard.hidden = false;
    } catch (error) {
        resultCard.hidden = false;
        resultAmount.textContent = "Could not estimate";
        resultNote.textContent = error.message;
        resultVehicle.textContent = "";
    } finally {
        submitButton.disabled = false;
        submitLabel.textContent = "Get estimate";
    }
});

recordsTableBody.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-record-id]");
    if (!deleteButton) {
        return;
    }

    records = records.filter((record) => record.id !== deleteButton.dataset.recordId);
    try {
        saveRecords();
    } catch (error) {
        storageError = error.message;
    }
    renderRecords();
});

clearRecordsButton.addEventListener("click", () => {
    if (!window.confirm("Clear all saved prediction records from this browser?")) {
        return;
    }

    records = [];
    try {
        saveRecords();
    } catch (error) {
        storageError = error.message;
    }
    renderRecords();
});

try {
    records = readRecords();
} catch (error) {
    storageError = error.message;
}
renderRecords();
