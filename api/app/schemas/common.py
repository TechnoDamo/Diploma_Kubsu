from pydantic import BaseModel


class Paginated(BaseModel):
    items: list
    total: int
    page: int
    limit: int
