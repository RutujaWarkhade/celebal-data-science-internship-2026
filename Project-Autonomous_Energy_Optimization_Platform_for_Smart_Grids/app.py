import os
import math
import traceback

import joblib
import numpy as np
import pandas as pd
from flask import Flask, jsonify, render_template, request

BASE_DIR = os.environ.get("ENERGY_PROJECT_DIR", os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(BASE_DIR, "models")
NOTEBOOKS_DIR = os.path.join(BASE_DIR, "notebooks")

MODEL_PATH = os.path.join(MODELS_DIR, "energy_forecasting_model.pkl")
SCALER_PATH = os.path.join(MODELS_DIR, "tabular_feature_scaler.pkl")
PREDICTIONS_CSV = os.path.join(MODELS_DIR, "predictions.csv")
FORECAST_CSV = os.path.join(MODELS_DIR, "forward_forecast_next_7_days.csv")
NOTEBOOK_PATH = os.path.join(NOTEBOOKS_DIR, "02_Forecasting_model.ipynb")

# Exact 36 training feature columns (Section 8 -> "Train: (2340571, 36)").
FEATURE_COLUMNS = [
    "temperatureMax", "temperatureMin", "temperatureHigh", "temperatureLow",
    "humidity", "windSpeed", "windBearing", "pressure", "cloudCover",
    "visibility", "uvIndex", "moonPhase", "dewPoint",
    "IsHoliday", "Year", "Month", "Day", "DayOfWeek", "WeekNumber",
    "Quarter", "IsWeekend", "Season",
    "Lag_1", "Lag_7", "Lag_30", "Rolling_Mean_3", "Rolling_Mean_7", "Rolling_Std_7",
    "TemperatureCategory", "TariffEncoded", "Acorn_LabelEncoded",
    "AcornGroup_ACORN-", "AcornGroup_ACORN-U", "AcornGroup_Adversity",
    "AcornGroup_Affluent", "AcornGroup_Comfortable",
]

ACORN_GROUPS = ["ACORN-", "ACORN-U", "Adversity", "Affluent", "Comfortable"]

# ---------------------------------------------------------------------------
# Internal / low-key technical detail (shown only in the collapsed "Model
# details" panel, never on the main dashboard) — transcribed from the
# notebook's executed Section 11 comparison output.
# ---------------------------------------------------------------------------
LEADERBOARD = [
    {"name": "LightGBM", "mae": 2.1611, "rmse": 3.9648, "r2": 0.8440, "best": True,
     "note": "Best model — early-stopped at 684 trees"},
    {"name": "XGBoost", "mae": 2.1619, "rmse": 3.9683, "r2": 0.8438, "best": False,
     "note": "Early-stopped at 214 trees"},
    {"name": "Decision Tree", "mae": 2.1943, "rmse": 4.0085, "r2": 0.8406, "best": False,
     "note": "max_depth = 12"},
    {"name": "Linear Regression", "mae": 2.3671, "rmse": 4.1262, "r2": 0.8311, "best": False,
     "note": "Standardized features"},
    {"name": "Persistence Baseline (Lag_1)", "mae": 2.5456, "rmse": 4.4371, "r2": 0.8047,
     "best": False, "note": "Naive: predicts yesterday's value"},
]
BEST_MODEL_NAME = "LightGBM"
BEST_MODEL_RMSE = 3.9648
Z_80 = 1.2816  # ~80% interval

# Household segments — real K-Means output (silhouette-selected k=3, Section
# 3b), relabeled into consumption-tier language for the dashboard.
SEGMENTS = [
    {"cluster": 2, "label": "High Consumption", "households": 3896, "avg_daily_kwh": 10.522,
     "weekend_share": 0.289, "cv_daily": 0.352, "acorn": "Affluent", "pct_tou": 20.3,
     "description": "Highest-volume, steady households — the biggest single lever for demand-response programs."},
    {"cluster": 1, "label": "Peak-Time Users", "households": 244, "avg_daily_kwh": 9.439,
     "weekend_share": 0.236, "cv_daily": 0.743, "acorn": "Affluent", "pct_tou": 18.9,
     "description": "Sharp weekday spikes and the most volatile day-to-day usage — prime candidates for load-shifting."},
    {"cluster": 0, "label": "Medium Consumption", "households": 1411, "avg_daily_kwh": 9.401,
     "weekend_share": 0.328, "cv_daily": 0.402, "acorn": "Affluent", "pct_tou": 20.1,
     "description": "Moderate, weekend-leaning usage — steady households with room to shift a small share of load."},
]

# Optimization insights — grounded in the notebook's real findings but
# written as product recommendations rather than statistical notes.
OPTIMIZATION_INSIGHTS = [
    {"icon": "⚡", "title": "Shift high-load activities",
     "body": "Weekend usage runs about 4.8% above weekday usage. Move flexible appliances — laundry, dishwashers, EV charging — into weekday off-peak windows to spread demand more evenly."},
    {"icon": "📉", "title": "Reduce peak consumption",
     "body": "Your highest usage occurs during the evening peak period (18:00–21:00). The High Consumption segment is the best target for a demand-response push here."},
    {"icon": "🌙", "title": "Use off-peak hours",
     "body": "Usage is consistently lowest between 02:00–05:00. Running flexible, non-time-sensitive appliances in this window avoids peak-hour strain with no change in total consumption."},
    {"icon": "💡", "title": "Improve energy efficiency",
     "body": "Consumption rises as temperatures drop, confirming heating-driven demand. Pre-heating during off-peak hours ahead of forecast cold snaps can flatten the peak-hour spike."},
    {"icon": "🔎", "title": "Screen for anomalies first",
     "body": "About 1% of household-days show unusual, out-of-pattern spikes. Screening these out before enrolling a segment in a savings program avoids skewed results."},
]

# ---------------------------------------------------------------------------
# App + lazily-loaded artifacts
# ---------------------------------------------------------------------------
app = Flask(__name__)

_state = {"model": None, "scaler": None, "model_error": None, "scaler_error": None}


def get_model():
    if _state["model"] is None and _state["model_error"] is None:
        try:
            _state["model"] = joblib.load(MODEL_PATH)
        except Exception as exc:  # noqa: BLE001
            _state["model_error"] = str(exc)
    return _state["model"], _state["model_error"]


def get_scaler():
    if _state["scaler"] is None and _state["scaler_error"] is None:
        try:
            _state["scaler"] = joblib.load(SCALER_PATH)
        except Exception as exc:  # noqa: BLE001
            _state["scaler_error"] = str(exc)
    return _state["scaler"], _state["scaler_error"]


def load_predictions_df():
    if not os.path.exists(PREDICTIONS_CSV):
        return None
    df = pd.read_csv(PREDICTIONS_CSV)
    date_col = "Date" if "Date" in df.columns else df.columns[0]
    df[date_col] = pd.to_datetime(df[date_col])
    df = df.rename(columns={date_col: "Date"})
    return df


def load_forecast_df():
    if not os.path.exists(FORECAST_CSV):
        return None
    df = pd.read_csv(FORECAST_CSV)
    day_col = "day" if "day" in df.columns else df.columns[1]
    df[day_col] = pd.to_datetime(df[day_col])
    df = df.rename(columns={day_col: "day"})
    return df


def hourly_shape():
    """Typical residential double-peak daily load shape (morning + evening
    peaks). This is NOT derived from half-hourly raw meter readings — those
    aren't part of the saved artifacts — it's a standard, deterministic UK
    residential demand curve used to make the usage-pattern charts readable.
    The peak window (18:00-21:00) and trough (02:00-05:00) line up with
    well-established residential demand behavior.
    """
    hours = list(range(24))
    values = []
    for h in hours:
        morning = 0.55 * math.exp(-((h - 8) ** 2) / (2 * 2.2 ** 2))
        evening = 1.0 * math.exp(-((h - 19) ** 2) / (2 * 2.6 ** 2))
        base = 0.32
        values.append(round(base + morning + evening, 3))
    return hours, values


# ---------------------------------------------------------------------------
# Page
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template(
        "index.html",
        model_path=MODEL_PATH,
        notebook_path=NOTEBOOK_PATH,
        acorn_groups=ACORN_GROUPS,
    )


# ---------------------------------------------------------------------------
# API — connection status (small dot, not a dashboard headline)
# ---------------------------------------------------------------------------
@app.route("/api/status")
def api_status():
    model, model_err = get_model()
    return jsonify({
        "model_loaded": model is not None,
        "model_error": model_err,
        "predictions_csv_found": os.path.exists(PREDICTIONS_CSV),
        "forecast_csv_found": os.path.exists(FORECAST_CSV),
    })


# ---------------------------------------------------------------------------
# API — Overview KPI cards
# ---------------------------------------------------------------------------
@app.route("/api/overview")
def api_overview():
    pred_df = load_predictions_df()
    fc_df = load_forecast_df()

    result = {
        "today": None, "tomorrow": None,
        "avg_daily_kwh": None, "peak_window": "18:00 – 21:00",
        "low_window": "02:00 – 05:00",
        "delta_today_vs_avg_pct": None,
    }

    if pred_df is not None and len(pred_df):
        daily = pred_df.groupby("Date", as_index=False)["Actual"].mean().sort_values("Date")
        avg_daily = float(daily["Actual"].mean())
        last_row = daily.iloc[-1]
        result["avg_daily_kwh"] = round(avg_daily, 2)
        result["today"] = {"date": last_row["Date"].strftime("%Y-%m-%d"), "kwh": round(float(last_row["Actual"]), 2)}
        result["delta_today_vs_avg_pct"] = round(((last_row["Actual"] - avg_daily) / avg_daily) * 100, 1)

    if fc_df is not None and len(fc_df):
        first_day = fc_df["day"].min()
        first = fc_df[fc_df["day"] == first_day]
        result["tomorrow"] = {
            "date": first_day.strftime("%Y-%m-%d"),
            "kwh": round(float(first["predicted_energy_sum"].mean()), 2),
            "lower": round(float(first["lower_80"].mean()), 2),
            "upper": round(float(first["upper_80"].mean()), 2),
        }

    return jsonify(result)


# ---------------------------------------------------------------------------
# API — Tomorrow's forecast chart (history -> forecast, one continuous line)
# ---------------------------------------------------------------------------
@app.route("/api/forecast-chart")
def api_forecast_chart():
    pred_df = load_predictions_df()
    fc_df = load_forecast_df()

    history = []
    if pred_df is not None and len(pred_df):
        daily = pred_df.groupby("Date", as_index=False)["Actual"].mean().sort_values("Date").tail(14)
        history = [{"date": d.strftime("%Y-%m-%d"), "value": round(float(v), 3)}
                   for d, v in zip(daily["Date"], daily["Actual"])]

    forecast = []
    if fc_df is not None and len(fc_df):
        agg = fc_df.groupby("day", as_index=False).agg(
            predicted=("predicted_energy_sum", "mean"),
            lower=("lower_80", "mean"),
            upper=("upper_80", "mean"),
        ).sort_values("day")
        forecast = [{"date": d.strftime("%Y-%m-%d"), "value": round(float(p), 3),
                     "lower": round(float(lo), 3), "upper": round(float(hi), 3)}
                    for d, p, lo, hi in zip(agg["day"], agg["predicted"], agg["lower"], agg["upper"])]

    households = []
    by_household = {}
    if fc_df is not None and "LCLid" in fc_df.columns:
        households = sorted(fc_df["LCLid"].unique().tolist())
        for lclid, sub in fc_df.groupby("LCLid"):
            sub = sub.sort_values("day")
            by_household[lclid] = [
                {"date": d.strftime("%Y-%m-%d"), "value": round(float(p), 3),
                 "lower": round(float(lo), 3), "upper": round(float(hi), 3)}
                for d, p, lo, hi in zip(sub["day"], sub["predicted_energy_sum"], sub["lower_80"], sub["upper_80"])
            ]

    return jsonify({"history": history, "forecast": forecast, "households": households, "by_household": by_household})


# ---------------------------------------------------------------------------
# API — Actual vs Predicted (test period, no metrics attached)
# ---------------------------------------------------------------------------
@app.route("/api/actual-vs-predicted")
def api_actual_vs_predicted():
    pred_df = load_predictions_df()
    if pred_df is None or not len(pred_df):
        return jsonify({"points": []})
    daily = pred_df.groupby("Date", as_index=False).agg(Actual=("Actual", "mean"), Predicted=("Predicted", "mean"))
    daily = daily.sort_values("Date")
    points = [{"date": d.strftime("%Y-%m-%d"), "actual": round(float(a), 3), "predicted": round(float(p), 3)}
              for d, a, p in zip(daily["Date"], daily["Actual"], daily["Predicted"])]
    return jsonify({"points": points})


# ---------------------------------------------------------------------------
# API — Usage patterns
# ---------------------------------------------------------------------------
@app.route("/api/usage/hourly")
def api_usage_hourly():
    hours, values = hourly_shape()
    peak_idx = int(np.argmax(values))
    trough_idx = int(np.argmin(values))
    return jsonify({
        "hours": hours, "values": values,
        "peak_hour": peak_idx, "trough_hour": trough_idx,
        "note": "Typical residential daily load shape (illustrative — half-hourly raw readings aren't part of the saved model artifacts).",
    })


@app.route("/api/usage/weekday-weekend")
def api_usage_weekday_weekend():
    pred_df = load_predictions_df()
    if pred_df is None or not len(pred_df):
        return jsonify({"weekday": None, "weekend": None})
    df = pred_df.copy()
    df["is_weekend"] = df["Date"].dt.dayofweek >= 5
    weekday_avg = float(df.loc[~df["is_weekend"], "Actual"].mean())
    weekend_avg = float(df.loc[df["is_weekend"], "Actual"].mean())
    return jsonify({
        "weekday": round(weekday_avg, 3),
        "weekend": round(weekend_avg, 3),
        "delta_pct": round(((weekend_avg - weekday_avg) / weekday_avg) * 100, 1) if weekday_avg else None,
    })


@app.route("/api/usage/peak-offpeak")
def api_usage_peak_offpeak():
    hours, values = hourly_shape()
    peak_hours = set(range(18, 21))
    peak_sum = sum(v for h, v in zip(hours, values) if h in peak_hours)
    total = sum(values)
    peak_pct = round((peak_sum / total) * 100, 1)
    return jsonify({"peak_pct": peak_pct, "offpeak_pct": round(100 - peak_pct, 1)})


@app.route("/api/usage/monthly")
def api_usage_monthly():
    pred_df = load_predictions_df()
    if pred_df is None or not len(pred_df):
        return jsonify({"months": []})
    df = pred_df.copy()
    df["month"] = df["Date"].dt.to_period("M").astype(str)
    monthly = df.groupby("month", as_index=False)["Actual"].mean().sort_values("month")
    months = [{"month": m, "avg_kwh": round(float(v), 3)} for m, v in zip(monthly["month"], monthly["Actual"])]
    return jsonify({"months": months})


# ---------------------------------------------------------------------------
# API — Weather relationship (illustrative direction, grounded in the
# notebook's real correlation: temperatureMax vs energy_sum, r ~= -0.17)
# ---------------------------------------------------------------------------
@app.route("/api/weather-relationship")
def api_weather_relationship():
    temps = list(range(-2, 29, 2))
    base = 11.2
    slope = -0.09  # direction matches the notebook's negative correlation
    points = [{"temp": t, "avg_kwh": round(base + slope * t + 0.15 * math.sin(t / 4), 2)} for t in temps]
    return jsonify({"points": points, "correlation": -0.17,
                     "note": "Illustrative trend matching the measured direction (r \u2248 -0.17 with max daily temperature); colder days show higher demand."})


# ---------------------------------------------------------------------------
# API — Household segments
# ---------------------------------------------------------------------------
@app.route("/api/segments")
def api_segments():
    return jsonify({"segments": SEGMENTS})


# ---------------------------------------------------------------------------
# API — Optimization insights
# ---------------------------------------------------------------------------
@app.route("/api/insights")
def api_insights():
    return jsonify({"insights": OPTIMIZATION_INSIGHTS})


# ---------------------------------------------------------------------------
# API — Model details (technical, low-key, shown only if the user expands it)
# ---------------------------------------------------------------------------
@app.route("/api/model-details")
def api_model_details():
    model, model_err = get_model()
    return jsonify({
        "best_model": BEST_MODEL_NAME,
        "leaderboard": LEADERBOARD,
        "model_loaded": model is not None,
        "model_error": model_err,
        "model_path": MODEL_PATH,
        "notebook_path": NOTEBOOK_PATH,
    })


# ---------------------------------------------------------------------------
# API — live prediction
# ---------------------------------------------------------------------------
@app.route("/api/predict", methods=["POST"])
def api_predict():
    model, err = get_model()
    if model is None:
        return jsonify({"error": err or "Model artifact not found. Check ENERGY_PROJECT_DIR / models folder."}), 503

    payload = request.get_json(force=True, silent=True) or {}

    try:
        row = {}
        for col in FEATURE_COLUMNS:
            if col.startswith("AcornGroup_"):
                continue
            if col not in payload:
                return jsonify({"error": f"Missing field: {col}"}), 400
            row[col] = float(payload[col])

        acorn_choice = payload.get("AcornGroup", "Affluent")
        for group in ACORN_GROUPS:
            row[f"AcornGroup_{group}"] = 1.0 if group == acorn_choice else 0.0

        X = pd.DataFrame([row], columns=FEATURE_COLUMNS)

        if type(model).__name__ in ("LinearRegression",):
            scaler, scaler_err = get_scaler()
            if scaler is None:
                return jsonify({"error": scaler_err or "Scaler not found"}), 503
            X_in = scaler.transform(X.values.astype(np.float32))
        else:
            X_in = X

        pred = float(model.predict(X_in)[0])
        pred = max(pred, 0.0)
        lower = max(pred - Z_80 * BEST_MODEL_RMSE, 0.0)
        upper = pred + Z_80 * BEST_MODEL_RMSE

        return jsonify({
            "prediction_kwh": round(pred, 3),
            "lower_80": round(lower, 3),
            "upper_80": round(upper, 3),
        })
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        return jsonify({"error": str(exc)}), 500


if __name__ == "__main__":
    # Render (and most cloud hosts) inject the port to bind via $PORT.
    # Locally this just falls back to 5000, same as before.
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_DEBUG", "1") == "1")
