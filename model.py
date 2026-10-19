from pathlib import Path

import joblib
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import ExtraTreesRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, median_absolute_error, r2_score
from sklearn.model_selection import GridSearchCV, KFold, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, TargetEncoder


BASE_DIR = Path(__file__).resolve().parent
DATA_PATH = BASE_DIR / "quikr_car - quikr_car.csv"
MODEL_PATH = BASE_DIR / "model.pkl"
FEATURE_COLUMNS = ["car_name", "company", "year", "kms_driven", "fuel_type"]
CATEGORICAL_COLUMNS = ["car_name", "company", "fuel_type"]
NUMERIC_COLUMNS = ["year", "kms_driven"]


def load_training_data() -> pd.DataFrame:
    df = pd.read_csv(DATA_PATH)
    df = df.rename(columns={"name": "car_name", "Price": "price"})

    required_columns = [*FEATURE_COLUMNS, "price"]
    missing_columns = sorted(set(required_columns) - set(df.columns))
    if missing_columns:
        raise ValueError(f"Dataset is missing required columns: {', '.join(missing_columns)}")

    for column in CATEGORICAL_COLUMNS:
        df[column] = df[column].astype("string").str.strip().replace("", pd.NA)

    df["year"] = pd.to_numeric(df["year"], errors="coerce")
    df["price"] = pd.to_numeric(
        df["price"].astype("string").str.replace(",", "", regex=False),
        errors="coerce",
    )
    df["kms_driven"] = pd.to_numeric(
        df["kms_driven"]
        .astype("string")
        .str.replace(r"\s*kms?\s*$", "", case=False, regex=True)
        .str.replace(",", "", regex=False),
        errors="coerce",
    )

    df = df.dropna(subset=required_columns)
    df = df[
        (df["year"] >= 1900)
        & (df["price"] > 0)
        & (df["kms_driven"] >= 0)
    ].copy()

    if len(df) < 2:
        raise ValueError("Dataset must contain at least two valid car records to train.")

    return df


def create_model() -> Pipeline:
    preprocessing = ColumnTransformer(
        transformers=[
            (
                "car_name",
                TargetEncoder(
                    target_type="continuous",
                    cv=KFold(n_splits=5, shuffle=True, random_state=43),
                ),
                ["car_name"],
            ),
            (
                "other_categories",
                OneHotEncoder(handle_unknown="ignore"),
                ["company", "fuel_type"],
            ),
            ("numeric", "passthrough", NUMERIC_COLUMNS),
        ]
    )
    pipeline = Pipeline(
        steps=[
            ("preprocessing", preprocessing),
            (
                "regressor",
                ExtraTreesRegressor(
                    n_estimators=400,
                    random_state=42,
                    n_jobs=-1,
                ),
            ),
        ]
    )
    return pipeline


def train() -> None:
    df = load_training_data()
    features = df[FEATURE_COLUMNS]
    target = df["price"]

    x_train, x_test, y_train, y_test = train_test_split(
        features,
        target,
        test_size=0.2,
        random_state=31,
    )
    cross_validation = KFold(n_splits=4, shuffle=True, random_state=42)
    search = GridSearchCV(
        create_model(),
        param_grid={
            "regressor__max_depth": [None, 12],
            "regressor__max_features": [0.3, 0.5, 0.8, 1.0],
            "regressor__min_samples_leaf": [1, 2, 4],
        },
        scoring="neg_mean_absolute_error",
        cv=cross_validation,
        n_jobs=1,
    )
    search.fit(x_train, y_train)
    predictions = search.predict(x_test)
    r2 = r2_score(y_test, predictions)
    mae = mean_absolute_error(y_test, predictions)
    median_ae = median_absolute_error(y_test, predictions)
    rmse = mean_squared_error(y_test, predictions) ** 0.5

    model = create_model()
    model.set_params(**search.best_params_)
    model.fit(features, target)
    joblib.dump(
        {
            "model": model,
            "metrics": {
                "r2": float(r2),
                "test_size": len(y_test),
                "best_params": search.best_params_,
            },
        },
        MODEL_PATH,
    )

    print(f"Trained on {len(df)} valid records from {DATA_PATH.name}.")
    print("Holdout evaluation (20%, excluded from training-set cross-validation):")
    print(f"Best Extra Trees parameters: {search.best_params_}")
    print(f"R^2: {r2:.3f}")
    print(f"Mean absolute error: INR {mae:,.0f}")
    print(f"Median absolute error: INR {median_ae:,.0f}")
    print(f"Root mean squared error: INR {rmse:,.0f}")
    print(f"Saved model to {MODEL_PATH}")


if __name__ == "__main__":
    train()
