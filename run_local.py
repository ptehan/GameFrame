import webbrowser
import threading
import uvicorn

def open_browser():
    webbrowser.open("http://127.0.0.1:8000")

if __name__ == "__main__":
    threading.Timer(1.0, open_browser).start()
    uvicorn.run("app:app", host="127.0.0.1", port=8000)
