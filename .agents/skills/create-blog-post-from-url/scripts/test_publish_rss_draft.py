"""Offline bridge tests: inject the publisher module; never import live APIs."""
from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

SCRIPT = Path(__file__).with_name("publish-rss-draft.py")
SPEC = importlib.util.spec_from_file_location("rss_draft_bridge_under_test", SCRIPT)
BRIDGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BRIDGE)
SOURCE = "https://source.example/article"
SECRET_TEXT = "https://api.weixin.qq.com/cgi-bin/draft/add?access_token=DO_NOT_LEAK_SECRET"
PNG = bytes.fromhex("89504e470d0a1a0a")


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="rss-bridge-test-")
        self.addCleanup(self.temporary.cleanup)
        self.workspace = Path(self.temporary.name).resolve()
        self.task = self.workspace / "output/rss-articles/offline_task-1"
        self.assets = self.task / "assets"
        self.assets.mkdir(parents=True)
        (self.task / "article.md").write_text("# Offline article", encoding="utf-8")
        (self.assets / "01-cover.png").write_bytes(PNG)
        (self.assets / "02-illustration-topic.png").write_bytes(PNG)
        self.input = {"version": 1, "mode": "rss-article", "task_id": "offline_task-1", "source_url": SOURCE}
        self.result = {**self.input, "status": "running", "stage": "wechat_draft", "title": "中文标题",
                       "article_path": "output/rss-articles/offline_task-1/article.md",
                       "cover_path": "output/rss-articles/offline_task-1/assets/01-cover.png",
                       "inline_image_paths": ["output/rss-articles/offline_task-1/assets/02-illustration-topic.png"],
                       "media_id": None, "error": None, "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z"}
        self.write_json("input.json", self.input)
        self.write_json("result.json", self.result)
        self.write_json(".lock", {"token": "offline-lock", "pid": 1})
        self.publisher = SimpleNamespace(
            load_env_from_dotenv=Mock(), validate_args=Mock(),
            get_access_token=Mock(return_value="fake-token"),
            build_news_article=Mock(return_value={"article_type": "news", "thumb_media_id": "offline-thumb", "content": "<p>offline</p>"}),
            add_draft=Mock(return_value="offline-media-id"),
            submit_publish=Mock(side_effect=AssertionError("Publication must never be called")),
        )
        self.environment = patch.dict(os.environ, {"WECHAT_APP_ID": "configured-app", "WECHAT_APP_SECRET": "configured-secret"}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def write_json(self, name, value):
        (self.task / name).write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")

    def saved(self):
        return json.loads((self.task / "result.json").read_text(encoding="utf-8"))

    def run_bridge(self, **kwargs):
        return BRIDGE.run_bridge(self.task, "offline-lock", "中文标题", "中文摘要", SOURCE,
                                 workspace=self.workspace, module_loader=lambda: self.publisher, **kwargs)

    def assert_outcome(self, result, status, code=None):
        self.assertEqual(result["status"], status)
        self.assertEqual(result["stage"], "wechat_draft")
        self.assertEqual(result["error"]["code"] if result["error"] else None, code)
        self.assertEqual(self.saved(), result)
        self.assertEqual(result["created_at"], self.result["created_at"])
        self.assertNotEqual(result["updated_at"], self.result["updated_at"])
        self.assertNotIn("DO_NOT_LEAK", json.dumps(result))
        self.assertFalse(list(self.task.glob("*.tmp")))
        self.assertTrue((self.task / ".lock").exists())

    def test_success_uses_original_load_env_and_namespace_contract(self):
        result = self.run_bridge()
        self.assert_outcome(result, "succeeded")
        self.assertEqual(result["media_id"], "offline-media-id")
        self.assertNotIn("publish_id", result)
        self.assertNotIn("publish_status", result)
        self.assertNotIn("msg_data_id", result)
        self.publisher.submit_publish.assert_not_called()
        self.publisher.load_env_from_dotenv.assert_called_once_with()
        self.publisher.get_access_token.assert_called_once_with("configured-app", "configured-secret")
        args, token = self.publisher.build_news_article.call_args.args
        self.assertEqual(token, "fake-token")
        self.assertEqual(args.author, "Aide Hub")
        self.assertEqual(args.article_type, "news")
        self.assertEqual(args.content_format, "markdown")
        self.assertEqual(args.style_preset, "auto")
        self.assertFalse(args.ignore_image_errors)
        self.assertEqual(args.title, "中文标题")
        self.assertEqual(args.digest, "中文摘要")
        self.assertEqual(args.content_source_url, SOURCE)
        self.assertEqual(Path(args.content_file), self.task / "article.md")
        self.assertEqual(Path(args.cover_image), self.assets / "01-cover.png")
        self.publisher.add_draft.assert_called_once()
        self.assertEqual(self.run_bridge(), result)
        self.publisher.add_draft.assert_called_once()

    def test_draft_save_needs_no_publication_function(self):
        del self.publisher.submit_publish
        result = self.run_bridge()
        self.assert_outcome(result, "succeeded")
        self.assertEqual(result["media_id"], "offline-media-id")
        self.assertEqual(self.run_bridge(), result)
        self.publisher.add_draft.assert_called_once()

    def test_historical_publication_results_remain_unchanged_without_api_calls(self):
        for status, publication in (("succeeded", "submitted"), ("needs_attention", "rejected"), ("needs_attention", "unknown")):
            with self.subTest(status=status, publication=publication):
                stored = {**self.result, "status": status, "media_id": "existing-media",
                          "publish_status": publication, "publish_id": "historical-job",
                          "error": None if status == "succeeded" else {"code": "WECHAT_PUBLISH_REJECTED", "message": "historical error"}}
                self.write_json("result.json", stored)
                before = (self.task / "result.json").read_bytes()
                self.assertEqual(self.run_bridge(), stored)
                self.assertEqual((self.task / "result.json").read_bytes(), before)
        self.publisher.load_env_from_dotenv.assert_not_called()
        self.publisher.add_draft.assert_not_called()
        self.publisher.submit_publish.assert_not_called()

    def test_every_persisted_draft_blocks_recreation(self):
        for status in ("running", "failed", "needs_attention", "succeeded"):
            with self.subTest(status=status):
                stored = {**self.result, "status": status, "stage": "writing", "media_id": "existing-media",
                          "error": {"code": "WECHAT_API_REJECTED", "message": "old state"}}
                self.write_json("result.json", stored)
                result = self.run_bridge()
                if status in ("succeeded", "needs_attention"):
                    self.assertEqual(result, stored)
                else:
                    self.assert_outcome(result, "needs_attention", "WECHAT_SUBMISSION_UNKNOWN")
                self.assertEqual(result["media_id"], "existing-media")
                self.assertNotIn("publish_id", result)
                self.assertNotIn("publish_status", result)
        self.publisher.load_env_from_dotenv.assert_not_called()
        self.publisher.add_draft.assert_not_called()
        self.publisher.submit_publish.assert_not_called()

    def test_success_requires_nonempty_string_media_id(self):
        for value in (None, "", "  ", 42, {}, []):
            with self.subTest(value=value):
                self.write_json("result.json", self.result)
                self.publisher.add_draft.return_value = value
                self.assert_outcome(self.run_bridge(), "needs_attention", "WECHAT_SUBMISSION_UNKNOWN")

    def test_media_id_whitespace_is_normalized(self):
        self.publisher.add_draft.return_value = " media-id \n"
        self.assertEqual(self.run_bridge()["media_id"], "media-id")

    def test_missing_empty_and_placeholder_credentials_stop_before_token(self):
        for value in (None, "", "   ", "your_secret", "${WECHAT_APP_SECRET}", "%WECHAT_APP_SECRET%", "<secret>", "changeme"):
            with self.subTest(value=value):
                self.write_json("result.json", self.result)
                if value is None:
                    os.environ.pop("WECHAT_APP_SECRET", None)
                else:
                    os.environ["WECHAT_APP_SECRET"] = value
                self.assert_outcome(self.run_bridge(), "failed", "WECHAT_CONFIG_MISSING")
        self.publisher.get_access_token.assert_not_called()
        self.publisher.add_draft.assert_not_called()

    def test_original_load_env_can_populate_credentials(self):
        os.environ.clear()
        def dotenv():
            os.environ.setdefault("WECHAT_APP_ID", "dotenv-app")
            os.environ.setdefault("WECHAT_APP_SECRET", "dotenv-secret")
        self.publisher.load_env_from_dotenv.side_effect = dotenv
        self.assertEqual(self.run_bridge()["status"], "succeeded")
        self.publisher.get_access_token.assert_called_once_with("dotenv-app", "dotenv-secret")

    def test_token_timeout_is_preparation_failure_without_draft_submission(self):
        self.publisher.get_access_token.side_effect = TimeoutError(SECRET_TEXT)
        self.assert_outcome(self.run_bridge(), "failed", "WECHAT_PREPARATION_FAILED")
        self.publisher.build_news_article.assert_not_called()
        self.publisher.add_draft.assert_not_called()

    def test_image_preparation_failure_never_submits_draft(self):
        self.publisher.build_news_article.side_effect = RuntimeError(SECRET_TEXT)
        self.assert_outcome(self.run_bridge(), "failed", "WECHAT_PREPARATION_FAILED")
        self.publisher.add_draft.assert_not_called()

    def test_missing_thumb_or_token_is_preparation_failure(self):
        for token, prepared in ((None, {}), ("", {}), ("fake-token", {}), ("fake-token", None)):
            with self.subTest(token=token, prepared=prepared):
                self.write_json("result.json", self.result)
                self.publisher.get_access_token.return_value = token
                self.publisher.build_news_article.return_value = prepared
                self.assert_outcome(self.run_bridge(), "failed", "WECHAT_PREPARATION_FAILED")
        self.publisher.add_draft.assert_not_called()

    def test_original_argument_validation_systemexit_is_preparation_failure(self):
        self.publisher.validate_args.side_effect = SystemExit(2)
        self.assert_outcome(self.run_bridge(), "failed", "WECHAT_PREPARATION_FAILED")
        self.publisher.get_access_token.assert_not_called()
        self.publisher.add_draft.assert_not_called()

    def test_missing_optional_publisher_dependencies_is_structured(self):
        def missing_module():
            raise ModuleNotFoundError("No module named requests " + SECRET_TEXT)
        result = BRIDGE.run_bridge(self.task, "offline-lock", "中文标题", "中文摘要", SOURCE,
                                   workspace=self.workspace, module_loader=missing_module)
        self.assert_outcome(result, "failed", "WECHAT_DEPENDENCY_MISSING")
        self.publisher.add_draft.assert_not_called()

    def test_explicit_draft_api_rejection_is_failed(self):
        self.publisher.add_draft.side_effect = RuntimeError("新增草稿失败: errcode=45009, errmsg=" + SECRET_TEXT)
        self.assert_outcome(self.run_bridge(), "failed", "WECHAT_API_REJECTED")
        self.publisher.add_draft.assert_called_once()

    def test_timeout_connection_http_json_or_other_submission_errors_are_unknown(self):
        failures = [TimeoutError(SECRET_TEXT), ConnectionError(SECRET_TEXT), OSError(SECRET_TEXT),
                    ValueError(SECRET_TEXT), KeyError("media_id"), RuntimeError(SECRET_TEXT),
                    RuntimeError("新增草稿失败: errcode=None, errmsg=" + SECRET_TEXT),
                    RuntimeError("新增草稿失败: errcode=0, errmsg=" + SECRET_TEXT), KeyboardInterrupt()]
        for error in failures:
            with self.subTest(error=type(error).__name__):
                self.write_json("result.json", self.result)
                self.publisher.add_draft.side_effect = error
                self.assert_outcome(self.run_bridge(), "needs_attention", "WECHAT_SUBMISSION_UNKNOWN")

    def test_unknown_state_never_calls_publisher_again(self):
        self.publisher.add_draft.side_effect = TimeoutError(SECRET_TEXT)
        result = self.run_bridge()
        self.assertEqual(self.run_bridge(), result)
        self.publisher.add_draft.assert_called_once()

    def test_all_original_logs_are_discarded_even_on_import_and_exception(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        def loader():
            print(SECRET_TEXT)
            print(SECRET_TEXT, file=__import__("sys").stderr)
            return self.publisher
        def submit(*_):
            print(SECRET_TEXT)
            raise TimeoutError(SECRET_TEXT)
        self.publisher.add_draft.side_effect = submit
        with redirect_stdout(stdout), redirect_stderr(stderr):
            result = BRIDGE.run_bridge(self.task, "offline-lock", "中文标题", "中文摘要", SOURCE,
                                       workspace=self.workspace, module_loader=loader)
        self.assert_outcome(result, "needs_attention", "WECHAT_SUBMISSION_UNKNOWN")
        self.assertEqual(stdout.getvalue(), "")
        self.assertEqual(stderr.getvalue(), "")
        self.assertNotIn("DO_NOT_LEAK", (self.task / "result.json").read_text(encoding="utf-8"))

    def test_wrong_lock_or_source_is_rejected_without_publisher(self):
        for lock, source in (("wrong-lock", SOURCE), ("offline-lock", "https://different.example/")):
            with self.subTest(lock=lock, source=source), self.assertRaises(BRIDGE.BridgeError):
                BRIDGE.run_bridge(self.task, lock, "中文标题", "中文摘要", source,
                                  workspace=self.workspace, module_loader=lambda: self.publisher)
        self.publisher.add_draft.assert_not_called()

    def test_bridge_refuses_unvalidated_stage_and_fixed_path_tampering(self):
        for change in ({"stage": "writing"}, {"status": "failed"}, {"article_path": "../../other.md"}, {"title": "changed"}):
            with self.subTest(change=change):
                self.write_json("result.json", {**self.result, **change})
                with self.assertRaises(BRIDGE.BridgeError):
                    self.run_bridge()
        self.publisher.add_draft.assert_not_called()

    def test_cover_escape_is_rejected_before_publisher(self):
        outside = self.workspace / "outside.png"
        outside.write_bytes(PNG)
        self.write_json("result.json", {**self.result, "cover_path": "outside.png"})
        with self.assertRaises(BRIDGE.BridgeError) as caught:
            self.run_bridge()
        self.assertEqual(caught.exception.code, "PATH_ESCAPE")
        self.publisher.add_draft.assert_not_called()

    def test_draft_result_write_failure_leaves_uncertain_state_for_parent(self):
        with patch.object(BRIDGE.os, "replace", side_effect=OSError(SECRET_TEXT)):
            with self.assertRaises(OSError):
                self.run_bridge()
        # The JS parent converts an abnormal bridge exit into needs_attention;
        # the old running/wechat_draft record never becomes retryable failed.
        self.assertEqual(self.saved()["status"], "running")
        self.assertEqual(self.saved()["stage"], "wechat_draft")
        self.assertFalse(list(self.task.glob("*.tmp")))
        self.publisher.add_draft.assert_called_once()
        self.publisher.submit_publish.assert_not_called()


if __name__ == "__main__":
    unittest.main()
