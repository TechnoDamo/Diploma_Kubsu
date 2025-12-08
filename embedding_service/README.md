gRPC server for functions implementing service logic.

python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

pyenv install 3.11.8
pyenv virtualenv 3.11.8 myenv
pyenv activate myenv

python -m pip install --upgrade pip setuptools wheel
python -m pip install --prefer-binary -r requirements.txt

*using pyenv, whl, virtual env usage 