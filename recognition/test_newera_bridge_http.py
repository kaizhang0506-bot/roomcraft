"""Loopback HTTP checks for the expensive local rendering bridge.

Starts a real TCP server with the expensive renderer mocked. No New Era process,
user project, model credentials or existing service on port 7878 is touched.
"""
import json
import socket
import threading
import time
import unittest
from unittest.mock import patch

import httpx
import uvicorn

from recognition import newera_bridge


PLAN = {
    'walls': [{'id': 'w1', 'start': {'x': 0, 'y': 0}, 'end': {'x': 4, 'y': 0}, 'height': 2.8, 'thickness': .18}],
    'rooms': [{'name': 'room', 'x': 0, 'y': 0, 'width': 4, 'depth': 5}],
    'openings': [], 'furniture': [],
}


class BridgeHttpSecurityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bound = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        cls.bound.bind(('127.0.0.1', 0))
        cls.bound.listen(128)
        cls.port = cls.bound.getsockname()[1]
        cls.patch = patch.object(newera_bridge, 'render', return_value={'image': 'example', 'renderer': 'mock'})
        cls.render_mock = cls.patch.start()
        cls.server = uvicorn.Server(uvicorn.Config(newera_bridge.app, log_level='error', lifespan='off'))
        cls.thread = threading.Thread(target=cls.server.run, kwargs={'sockets': [cls.bound]}, daemon=True)
        cls.thread.start()
        deadline = time.monotonic() + 10
        while not cls.server.started:
            if time.monotonic() >= deadline:
                cls.patch.stop()
                raise RuntimeError('Loopback test server failed to start')
            time.sleep(.02)
        cls.client = httpx.Client(base_url=f'http://127.0.0.1:{cls.port}', trust_env=False, timeout=10)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        cls.server.should_exit = True
        cls.thread.join(timeout=10)
        cls.bound.close()
        cls.patch.stop()

    def setUp(self):
        self.render_mock.reset_mock()

    def test_foreign_browser_origin_and_plain_text_are_rejected(self):
        response = self.client.post('/render', content=json.dumps({'plan': PLAN}), headers={'Origin': 'https://attacker.example', 'Content-Type': 'text/plain'})
        self.assertEqual(response.status_code, 403)
        self.render_mock.assert_not_called()

    def test_origin_null_and_local_browser_are_rejected(self):
        for origin in ('null', 'http://127.0.0.1:5173'):
            response = self.client.post('/render', json={'plan': PLAN}, headers={'Origin': origin})
            self.assertEqual(response.status_code, 403)
        self.render_mock.assert_not_called()

    def test_plain_text_without_origin_is_rejected(self):
        response = self.client.post('/render', content=json.dumps({'plan': PLAN}), headers={'Content-Type': 'text/plain'})
        self.assertEqual(response.status_code, 415)
        self.render_mock.assert_not_called()

    def test_server_json_without_origin_succeeds(self):
        response = self.client.post('/render', json={'plan': PLAN})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['renderer'], 'mock')
        self.render_mock.assert_called_once()

    def test_server_json_charset_parameter_is_allowed(self):
        response = self.client.post('/render', content=json.dumps({'plan': PLAN}), headers={'Content-Type': 'application/json; charset=utf-8'})
        self.assertEqual(response.status_code, 200)
        self.render_mock.assert_called_once()


if __name__ == '__main__':
    unittest.main()
