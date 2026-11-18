import unittest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from recognition.roomsmith_adapter import router


def sample():
    return {'roomId': 'r', 'plan': {'ceilingHeight': 2.8,
        'rooms': [{'id': 'r', 'name': '测试房', 'x': 0, 'y': 0, 'width': 4, 'depth': 3}],
        'walls': [{'id': 'w', 'start': {'x': 0, 'y': 0}, 'end': {'x': 4, 'y': 0}, 'thickness': .2}],
        'openings': [{'id': 'd1', 'wallId': 'w', 'kind': 'door', 'position': .5, 'width': .9, 'height': 2.1, 'sill': 0}],
        'furniture': [{'name': '桌子', 'x': 2, 'y': 1.5, 'width': 1, 'depth': .6, 'rotation': 0}]}}


class RoomsmithAdapterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app=FastAPI(); app.include_router(router); cls.client=TestClient(app)

    def test_real_upstream_generates_plan_with_geometry(self):
        response=self.client.post('/roomsmith/drawing',json=sample())
        self.assertEqual(response.status_code,200)
        result=response.json()
        self.assertEqual(result['provider'],'roomsmith-draw-plan')
        self.assertIn('测试房',result['svg'])
        self.assertIn('桌子',result['svg'])
        self.assertIn('门 d1',result['svg'])
        self.assertIn('4000 overall',result['svg'])
        self.assertIn('不是施工图',result['warnings'][0])

    def test_skipped_rotated_furniture_is_disclosed(self):
        body=sample(); body['plan']['furniture'][0]['rotation']=30
        result=self.client.post('/roomsmith/drawing',json=body).json()
        self.assertNotIn('桌子',result['svg'])
        self.assertTrue(any('斜向家具' in warning for warning in result['warnings']))

    def test_invalid_room_and_cross_origin_fail(self):
        body=sample(); body['roomId']='missing'
        self.assertEqual(self.client.post('/roomsmith/drawing',json=body).status_code,422)
        self.assertEqual(self.client.post('/roomsmith/drawing',json=sample(),headers={'origin':'https://evil.example'}).status_code,403)


if __name__=='__main__': unittest.main()
