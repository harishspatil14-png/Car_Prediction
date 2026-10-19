from pathlib import Path
import math
import textwrap

import joblib
import pandas as pd
from flask import Flask, Response, jsonify, render_template, request

try:
    from waitress import serve
except ImportError:  # pragma: no cover - served by fallback for lightweight local runs.
    serve = None

from model import FEATURE_COLUMNS, load_training_data

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "model.pkl"

app = Flask(__name__)


def load_model():
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Model file not found at {MODEL_PATH}. Train it with 'python model.py' first.")
    artifact = joblib.load(MODEL_PATH)
    if isinstance(artifact, dict) and "model" in artifact:
        return artifact["model"], artifact.get("metrics", {})
    return artifact, {}


try:
    model, model_metrics = load_model()
except FileNotFoundError as exc:
    model = None
    model_metrics = {}
    model_error = str(exc)
else:
    model_error = None

try:
    training_data = load_training_data()
except FileNotFoundError as exc:
    training_data = pd.DataFrame(columns=["company", "car_name", "fuel_type", "year", "kms_driven"])
    training_error = str(exc)
else:
    training_error = None

if training_error is None:
    input_suggestions = {
        column: sorted(training_data[column].dropna().unique().tolist())
        for column in ("company", "car_name", "fuel_type")
    }
    year_suggestions = sorted(training_data["year"].astype(int).unique().tolist())
    max_kilometers = int(training_data["kms_driven"].max())
    kilometer_suggestions = list(range(0, max_kilometers + 1, 5000))
    if kilometer_suggestions[-1] != max_kilometers:
        kilometer_suggestions.append(max_kilometers)
    company_variants = {
        company: sorted(group["car_name"].unique().tolist())
        for company, group in training_data.groupby("company")
    }
    dashboard_data = {
        "total_cars": len(training_data),
        "company_count": len(company_variants),
        "variant_count": training_data["car_name"].nunique(),
        "company_variants": company_variants,
        "fuel_counts": {
            fuel_type: int(count)
            for fuel_type, count in training_data["fuel_type"].value_counts().items()
        },
        "r2_score": model_metrics.get("r2"),
    }
else:
    input_suggestions = {"company": [], "car_name": [], "fuel_type": []}
    year_suggestions = []
    kilometer_suggestions = []
    company_variants = {}
    dashboard_data = {
        "total_cars": 0,
        "company_count": 0,
        "variant_count": 0,
        "company_variants": {},
        "fuel_counts": {},
        "r2_score": model_metrics.get("r2"),
    }


def create_records_pdf(records: list[dict[str, object]]) -> bytes:
    lines = []
    for index, record in enumerate(records, start=1):
        vehicle = f"{record['company']} {record['car_name']}"
        details = (
            f"Year: {record['year']} | Kilometers: {int(record['kms_driven']):,} | "
            f"Fuel: {record['fuel_type']} | Estimated value: INR {float(record['predicted_price']):,.0f} | "
            f"Date: {record['created_at']}"
        )
        lines.extend(textwrap.wrap(f"{index}. {vehicle}", width=88) or [""])
        lines.extend(textwrap.wrap(details, width=88) or [""])
        lines.append("")

    record_pages = [
        lines[index:index + 40]
        for index in range(0, len(lines), 40)
    ] or [[]]
    content_chunks = [
        ["CARWISE - PREDICTION RECORDS", f"Records exported: {len(records)}", "", *page_lines]
        for page_lines in record_pages
    ]
    pdf_objects: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ]
    page_references = []
    for page_index, page_lines in enumerate(content_chunks):
        page_object_number = 4 + page_index * 2
        content_object_number = page_object_number + 1
        page_references.append(f"{page_object_number} 0 R")
        commands = []
        for line_index, line in enumerate(page_lines):
            y_position = 750 - line_index * 16
            encoded_text = line.encode("cp1252", errors="replace").hex().upper()
            commands.append(
                f"BT /F1 10 Tf 50 {y_position} Td <{encoded_text}> Tj ET"
            )
        stream = "\n".join(commands).encode("ascii")
        pdf_objects.append(
            (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                f"/Resources << /Font << /F1 3 0 R >> >> "
                f"/Contents {content_object_number} 0 R >>"
            ).encode("ascii")
        )
        pdf_objects.append(
            f"<< /Length {len(stream)} >>\nstream\n".encode("ascii")
            + stream
            + b"\nendstream"
        )

    pdf_objects[1] = (
        f"<< /Type /Pages /Kids [{' '.join(page_references)}] "
        f"/Count {len(page_references)} >>"
    ).encode("ascii")
    document = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for object_number, pdf_object in enumerate(pdf_objects, start=1):
        offsets.append(len(document))
        document.extend(f"{object_number} 0 obj\n".encode("ascii"))
        document.extend(pdf_object)
        document.extend(b"\nendobj\n")

    cross_reference_offset = len(document)
    document.extend(f"xref\n0 {len(offsets)}\n".encode("ascii"))
    document.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        document.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    document.extend(
        (
            f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\n"
            f"startxref\n{cross_reference_offset}\n%%EOF"
        ).encode("ascii")
    )
    return bytes(document)


@app.route("/")
def index():
    return render_template(
        "index.html",
        input_suggestions=input_suggestions,
        dashboard_data=dashboard_data,
        year_suggestions=year_suggestions,
        kilometer_suggestions=kilometer_suggestions,
    )


@app.get("/api/companies")
def get_companies():
    if training_error is not None:
        return jsonify({"error": training_error}), 503
    return jsonify({"companies": sorted(company_variants)})


@app.get("/api/models")
def get_models():
    if training_error is not None:
        return jsonify({"error": training_error}), 503

    company = request.args.get("company", "").strip()
    if not company:
        return jsonify({"error": "A company name is required."}), 400

    matched_company = next(
        (name for name in company_variants if name.casefold() == company.casefold()),
        None,
    )
    return jsonify({"models": company_variants.get(matched_company, [])})


@app.route("/download-records", methods=["POST"])
def download_records():
    records = request.get_json()
    if not isinstance(records, list):
        return jsonify({"error": "A JSON array of prediction records is required."}), 400

    required_strings = ("car_name", "company", "created_at", "fuel_type")
    for record in records:
        if not isinstance(record, dict):
            return jsonify({"error": "Each prediction record must be a JSON object."}), 400
        if any(
            not isinstance(record.get(field), str) or not record[field].strip()
            for field in required_strings
        ):
            return jsonify({"error": "Each record must include its car, company, and date."}), 400
        if (
            isinstance(record.get("year"), bool)
            or not isinstance(record.get("year"), int)
            or record["year"] < 1900
            or isinstance(record.get("kms_driven"), bool)
            or not isinstance(record.get("kms_driven"), int)
            or record["kms_driven"] < 0
            or isinstance(record.get("predicted_price"), bool)
            or not isinstance(record.get("predicted_price"), (int, float))
            or record["predicted_price"] < 0
            or not math.isfinite(record["predicted_price"])
        ):
            return jsonify({"error": "Each record must include valid year, kilometers, and price values."}), 400

    pdf = create_records_pdf(records)
    return Response(
        pdf,
        mimetype="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="carwise-prediction-records.pdf"'},
    )


@app.route("/predict", methods=["POST"])
def predict():
    if model is None:
        return jsonify({"error": model_error or "Model is not available."}), 503

    data = request.get_json()
    if not isinstance(data, dict):
        return jsonify({"error": "A JSON object is required."}), 400

    car_name = data.get("car_name")
    company = data.get("company")
    fuel_type = data.get("fuel_type")
    if not all(isinstance(value, str) and value.strip() for value in (car_name, company, fuel_type)):
        return jsonify({"error": "Car name, company, and fuel type are required."}), 400

    try:
        year = int(data["year"])
        kms_driven = int(data["kms_driven"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "Year and kilometers driven must be whole numbers."}), 400

    if year < 1900 or kms_driven < 0:
        return jsonify({"error": "Enter a valid year and non-negative kilometers driven."}), 400

    input_values = {
        "car_name": car_name.strip(),
        "company": company.strip(),
        "year": year,
        "kms_driven": kms_driven,
        "fuel_type": fuel_type.strip(),
    }
    for column in ("car_name", "company", "fuel_type"):
        matching_values = training_data.loc[
            training_data[column].str.casefold() == input_values[column].casefold(),
            column,
        ].drop_duplicates()
        if not matching_values.empty:
            input_values[column] = matching_values.iloc[0]

    input_data = pd.DataFrame([input_values], columns=FEATURE_COLUMNS)
    exact_matches = training_data
    for column in ("car_name", "company", "fuel_type"):
        exact_matches = exact_matches[
            exact_matches[column].str.casefold() == input_values[column].casefold()
        ]
    exact_matches = exact_matches[
        (exact_matches["year"] == year)
        & (exact_matches["kms_driven"] == kms_driven)
    ]

    if not exact_matches.empty:
        prediction = exact_matches["price"].median()
    else:
        prediction = model.predict(input_data)[0]

    return jsonify({"predicted_price": round(float(prediction), 2)})


if __name__ == "__main__":
    if serve is not None:
        serve(app, host="127.0.0.1", port=5000)
    else:
        app.run(host="127.0.0.1", port=5000, debug=False, use_reloader=False)
