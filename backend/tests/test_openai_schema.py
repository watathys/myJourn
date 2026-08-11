from app.ai.schemas import DailyAIResult, openai_strict_schema


def test_openai_strict_schema_forbids_additional_properties() -> None:
    schema = openai_strict_schema(DailyAIResult)

    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == set(schema["properties"])
    nested = schema["$defs"]["GeneratedFollowUpQuestion"]
    assert nested["additionalProperties"] is False
    assert set(nested["required"]) == set(nested["properties"])
    assert nested["properties"]["dimension"] == {"$ref": "#/$defs/QuestionDimension"}
