"""Real Python imports from an installed skills tree outside the data workspace."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


class PortableResourcesTests(unittest.TestCase):
    def test_real_publisher_styles_and_configuration_stay_separate_from_workspace(self):
        with tempfile.TemporaryDirectory(prefix="rss-python-portable-") as temporary:
            root = Path(temporary)
            installed = root / "installed package" / "skills"
            shutil.copytree(Path(__file__).resolve().parents[2], installed,
                            ignore=shutil.ignore_patterns("__pycache__"))
            workspace = root / "content workspace"
            workspace.mkdir()
            unrelated = root / "unrelated cwd"
            unrelated.mkdir()
            (workspace / ".env").write_text(
                "WECHAT_APP_ID=offline-portable-app\nWECHAT_APP_SECRET=offline-portable-secret\n"
                "AZURE_API_KEY=offline-azure-key\n", encoding="utf-8")
            source = r'''
import importlib.util
import json
import os
from pathlib import Path
import sys
import requests

def forbidden(*args, **kwargs):
    raise AssertionError("Network calls are forbidden in portability checks")
requests.sessions.Session.request = forbidden
installed, workspace = map(Path, sys.argv[1:])
for name in ("WECHAT_APP_ID", "WECHAT_APP_SECRET", "AZURE_API_KEY"):
    os.environ.pop(name, None)
def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
bridge = load("portable_bridge", installed / "create-blog-post-from-url/scripts/publish-rss-draft.py")
publisher = bridge.load_publisher()
assert "WECHAT_APP_ID" not in os.environ, "Import must not load unrelated credentials"
publisher.load_env_from_dotenv(workspace)
assert os.environ["WECHAT_APP_ID"] == "offline-portable-app"
assert os.environ["WECHAT_APP_SECRET"] == "offline-portable-secret"
import style_manager
assert style_manager.STYLES_DIR.resolve() == installed / "wechat-draft/scripts/styles"
fragment = style_manager.build_styled_fragment("<p>本地样式资源</p>", "default", "")
assert "本地样式资源" in fragment and "style=" in fragment
azure = load("portable_azure", installed / "azure-image-gen/scripts/azure_generate_image.py")
os.chdir(workspace)
assert azure._read_env_file()["AZURE_API_KEY"] == "offline-azure-key"
assert not (workspace / ".agents").exists()
print(json.dumps({"publisher": True, "styles": True, "workspace_env": True, "network_calls": 0}))
'''
            result = subprocess.run([sys.executable, "-c", source, str(installed.resolve()), str(workspace.resolve())],
                                    cwd=unrelated, capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout),
                             {"publisher": True, "styles": True, "workspace_env": True, "network_calls": 0})


if __name__ == "__main__":
    unittest.main()
