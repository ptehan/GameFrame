import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ev-predictor'))
import clip_server


class FieldLocationsTest(unittest.TestCase):
    def test_saved_addresses_survive_new_handler_and_reject_invalid_coordinates(self):
        with tempfile.TemporaryDirectory() as directory:
            replies = []
            payload = {'location': {'label':'Test Field', 'query':'123 Field Street', 'lat':40.2, 'lon':-74.3}}
            with patch.object(clip_server, 'GAMEFRAME_DB', Path(directory) / 'app.db'), \
                 patch.object(clip_server, 'handle_json_body', side_effect=lambda handler: payload), \
                 patch.object(clip_server, 'json_response', side_effect=lambda handler,status,data:replies.append((status,data))):
                object.__new__(clip_server.ClipServerHandler).handle_field_locations()
                self.assertEqual(replies[-1][0],200)
                payload = {}
                object.__new__(clip_server.ClipServerHandler).handle_field_locations()
                self.assertEqual(replies[-1][1]['locations'][0]['query'],'123 Field Street')
                payload = {'location': {'label':'Test Field', 'lat':41, 'lon':-75}}
                object.__new__(clip_server.ClipServerHandler).handle_field_locations()
                self.assertEqual(len(replies[-1][1]['locations']),1)
                payload = {'location': {'label':'Invalid', 'lat':999, 'lon':0}}
                object.__new__(clip_server.ClipServerHandler).handle_field_locations()
                self.assertEqual(replies[-1][0],400)
                payload = {'location': {'label':'Other Field', 'lat':41, 'lon':-75}}
                object.__new__(clip_server.ClipServerHandler).handle_field_locations()
                payload = {'delete_label': "Test Field' OR 1=1 --"}
                object.__new__(clip_server.ClipServerHandler).handle_field_locations()
                self.assertEqual(len(replies[-1][1]['locations']),2)
                payload = {'delete_label':'Test Field'}
                object.__new__(clip_server.ClipServerHandler).handle_field_locations()
                self.assertEqual([row['label'] for row in replies[-1][1]['locations']],['Other Field'])
                payload = {}
                object.__new__(clip_server.ClipServerHandler).handle_field_locations()
                self.assertEqual([row['label'] for row in replies[-1][1]['locations']],['Other Field'])
                payload = {'delete_label':''}
                object.__new__(clip_server.ClipServerHandler).handle_field_locations()
                self.assertEqual(replies[-1][0],400)
