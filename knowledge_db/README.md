# Project database
This folder holds all the info about database of the project.
It is described with the [database.dbml](./database.dbml) file, 
which serves as a single source of truth for the project db state.

Full db schema backup is in [ERD_backup.json](./ERD_backup.json).
To open db schema properly, [deploy chartdb locally](https://github.com/chartdb/chartdb) or open cloud version
(local is preferred as it is free). After deployment choose import and insert backup file. 