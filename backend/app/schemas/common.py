from pydantic import BaseModel, ConfigDict

# Requests: unknown fields are an error, and surrounding whitespace is stripped before
# validation so " " cannot pass a min_length check.
REQUEST_CONFIG = ConfigDict(extra="forbid", str_strip_whitespace=True)


class RequestModel(BaseModel):
    model_config = REQUEST_CONFIG


class ResponseModel(BaseModel):
    # Lets responses be built straight from SQLAlchemy objects.
    model_config = ConfigDict(from_attributes=True)
