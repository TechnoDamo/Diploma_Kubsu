# Simple API description (very high-level)
POST /api/documents - uploads a document
Body - multipart/form-data

DELETE /api/documents/{id} - deletes a document with a given id

GET /api/documents - gets all documents info 
response: 
    json_array:
        json_object(s):
            document_id string
            document_name string
            document_size int

GET /api/documents/{id} - gets info for document with given id 
response: 
    json_object(s):
                document_id string
                document_name string
                document_size int

POST /api/documents/compare 
request:
    query_document_id string
    target_document_ids - json array of strings
response:
    text string

