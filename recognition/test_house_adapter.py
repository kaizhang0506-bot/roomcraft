import json
from pathlib import Path
import unittest
from unittest.mock import patch
from .house_adapter import recognize_house
from .recognizer import RecognitionError
from .sample import sample_png

class HouseConversionTests(unittest.TestCase):
    def test_wall_and_opening_conversion_does_not_invent_rooms(self):
        def run(command, **kwargs):
            out=Path(command[command.index('--out')+1]);out.mkdir()
            (out/'draft.json').write_text(json.dumps({'walls':[{'id':'W1','a':[0,0],'b':[4000,0],'t':200,'openings':[{'type':'door','from':1000,'to':1900}]}]}),encoding='utf-8')
            (out/'analysis.json').write_text(json.dumps({'mmPerPx':10}),encoding='utf-8')
            return type('Result',(),{'returncode':0})()
        with patch('recognition.house_adapter.subprocess.run',run),patch('recognition.house_adapter.Path.is_file',return_value=True):
            result=recognize_house(sample_png(),4)
        self.assertEqual(result['wallSegments'][0]['end']['x'],4)
        self.assertAlmostEqual(result['openings'][0]['position'],.3625)
        self.assertAlmostEqual(result['openings'][0]['width'],.9)
        self.assertEqual(result['roomPolygons'],[])
        self.assertTrue(result['needsReview'])

    def test_invalid_width_rejected_before_running(self):
        with self.assertRaises(RecognitionError): recognize_house(sample_png(),-1)

if __name__=='__main__': unittest.main()
