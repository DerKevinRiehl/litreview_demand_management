"""Check source-type conversion and compatibility with existing CSV files."""

import csv
from pathlib import Path
import tempfile
import unittest

from prepare_data import make_geojson


class SourceTypeTests(unittest.TestCase):
    def convert(self, source_types=None):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pins.csv"
            headers = ["id", "title", "latitude", "longitude", "date", "category"]
            if source_types is not None:
                headers.append("source_type")
            with path.open("w", encoding="utf-8", newline="") as file:
                writer = csv.writer(file)
                writer.writerow(headers)
                for index, source_type in enumerate(source_types if source_types is not None else [None]):
                    row = [f"item-{index}", "Example", 47.3, 8.5, "2020-01-01", "Transport"]
                    if source_types is not None:
                        row.append(source_type)
                    writer.writerow(row)
            return make_geojson(path)

    def test_legacy_csv_without_source_type(self):
        result = self.convert()
        self.assertEqual(result["features"][0]["properties"]["source_type"], "")

    def test_normalizes_news_science_and_blank(self):
        result = self.convert([" News ", "SCIENCE", ""])
        self.assertEqual(
            [feature["properties"]["source_type"] for feature in result["features"]],
            ["news", "science", ""],
        )

    def test_rejects_unknown_type_with_row_context(self):
        with self.assertRaisesRegex(ValueError, "Invalid row 2: source_type must be News, Science, or blank"):
            self.convert(["other"])


if __name__ == "__main__":
    unittest.main()
