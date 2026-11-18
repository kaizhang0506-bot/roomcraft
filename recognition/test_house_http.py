"""Run a real loopback recognition request against the upstream process."""
import json, os, socket, subprocess, sys, time, urllib.request, unittest
from .sample import sample_png, KNOWN_WIDTH_M

class HouseHttpTest(unittest.TestCase):
    def test_real_recognition(self):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        env=dict(os.environ,OPENBLAS_NUM_THREADS='1',OMP_NUM_THREADS='1',OPENCV_FOR_THREADS_NUM='1')
        process=subprocess.Popen([sys.executable,'-m','uvicorn','recognition.app:app','--host','127.0.0.1','--port',str(port)],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        base=f'http://127.0.0.1:{port}'
        try:
            for _ in range(80):
                try:
                    with urllib.request.urlopen(base+'/health',timeout=1): break
                except Exception: time.sleep(.25)
            else: self.fail('recognition test server did not start')
            boundary='roomcraft-house-integration-test'
            body=(f'--{boundary}\r\nContent-Disposition: form-data; name="known_width_m"\r\n\r\n{KNOWN_WIDTH_M}\r\n--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.png"\r\nContent-Type: image/png\r\n\r\n'.encode()+sample_png()+f'\r\n--{boundary}--\r\n'.encode())
            req=urllib.request.Request(base+'/recognize/house',data=body,headers={'Content-Type':f'multipart/form-data; boundary={boundary}'})
            with urllib.request.urlopen(req,timeout=70) as response: result=json.load(response)
            self.assertEqual(result['provider'],'house-plan-designer');self.assertGreater(len(result['wallSegments']),0)
            self.assertEqual(result['roomPolygons'],[]);self.assertTrue(result['needsReview'])
            print(f"House actual sample: {len(result['wallSegments'])} walls, {len(result['openings'])} openings, {len(result['roomPolygons'])} rooms")
        finally:
            process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired: process.kill();process.wait()

if __name__=='__main__': unittest.main()
