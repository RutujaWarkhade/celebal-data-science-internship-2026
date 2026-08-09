DATA FOLDER — NOT INCLUDED IN THIS REPOSITORY
===============================================

The datasets used in this project are NOT uploaded to GitHub because of
their large file size (the processed dataset alone is several GB).
This file explains where the data came from and how to regenerate it
yourself.

-----------------------------------------------------------------------
1. SOURCE DATASET
-----------------------------------------------------------------------
All raw data comes from the "Smart Meters in London" dataset on Kaggle:

    https://www.kaggle.com/datasets/jeanmidev/smart-meters-in-london

From that dataset, the following 4 files were used:

  1. daily_dataset.csv
     https://www.kaggle.com/datasets/jeanmidev/smart-meters-in-london?select=daily_dataset.csv
     -> Daily energy consumption readings per household (LCLid).

  2. informations_households.csv
     https://www.kaggle.com/datasets/jeanmidev/smart-meters-in-london?select=informations_households.csv
     -> Household metadata: Acorn group, Acorn category, tariff type (Std/ToU).

  3. weather_daily_darksky.csv
     https://www.kaggle.com/datasets/jeanmidev/smart-meters-in-london?select=weather_daily_darksky.csv
     -> Daily weather data (temperature, humidity, wind, pressure, etc.)

  4. uk_bank_holidays.csv
     https://www.kaggle.com/datasets/jeanmidev/smart-meters-in-london?select=uk_bank_holidays.csv
     -> UK public holiday calendar, used to engineer the IsHoliday feature.

-----------------------------------------------------------------------
2. HOW THE PROCESSED DATASET WAS BUILT
-----------------------------------------------------------------------
The 4 raw files above were cleaned, merged, and feature-engineered in
the notebook:

    notebooks/01_Data_Preprocessing.ipynb

This notebook performs data quality checks, cleaning, memory
optimization, exploratory analysis, and feature engineering (calendar
features, lag features, rolling statistics, Acorn one-hot encoding,
etc.), then saves the final merged/engineered table as:

    energy_analytics_dataset.csv

This processed file is what feeds into:

    notebooks/02_Forecasting_Model.ipynb

which trains, evaluates, and saves the forecasting model used by the
web app.

-----------------------------------------------------------------------
3. HOW TO GET THE DATA YOURSELF
-----------------------------------------------------------------------
Step 1: Download the 4 raw CSV files from the Kaggle dataset link above
        (requires a free Kaggle account). Place them in this `data/`
        folder.

Step 2: Run `notebooks/01_Data_Preprocessing.ipynb` from top to bottom.
        This will read the raw CSVs and generate
        `energy_analytics_dataset.csv` in this same folder.

Step 3: Run `notebooks/02_Forecasting_Model.ipynb` from top to bottom.
        This will train the model and save the model artifacts
        (energy_forecasting_model.pkl, tabular_feature_scaler.pkl,
        predictions.csv, forward_forecast_next_7_days.csv) into the
        `models/` folder, which `app.py` reads at runtime.

-----------------------------------------------------------------------
4. LICENSE / ATTRIBUTION
-----------------------------------------------------------------------
The dataset is provided by UK Power Networks via the London Datastore
and shared on Kaggle by user jeanmidev. Please refer to the Kaggle
dataset page for license terms and usage guidelines before using this
data outside of this project.
