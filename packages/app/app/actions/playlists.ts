import fs from 'fs';
import { v4 } from 'uuid';
import _ from 'lodash';
import { remote } from 'electron';
import { createAsyncAction } from 'typesafe-actions';

import { store, PlaylistHelper, Playlist, PlaylistTrack, rest } from '@nuclear/core';
import { GetPlaylistsByUserIdResponseBody } from '@nuclear/core/src/rest/Nuclear/Playlists.types';
import { ErrorBody } from '@nuclear/core/src/rest/Nuclear/types';

import { Playlists } from './actionTypes';

import {
  deletePlaylistEffect,
  updatePlaylistEffect,
  updatePlaylistsOrderEffect
} from './playlists.effects';
import { success, error } from './toasts';
import { IdentityStore } from '../reducers/nuclear/identity';

export const addPlaylist = (tracks: Array<PlaylistTrack>, name: string) => dispatch => {
  if (name?.length === 0) {
    return;
  }
  let playlists = store.get('playlists') || [];
  const playlist = PlaylistHelper.formatPlaylistForStorage(name, tracks, v4());

  playlists = [...playlists, playlist];

  store.set('playlists', playlists);
  dispatch({
    type: Playlists.ADD_PLAYLIST,
    payload: { playlists }
  });
};

export const deletePlaylist = (id: string) => dispatch => {
  const playlists = deletePlaylistEffect(store)(id);

  dispatch({
    type: Playlists.DELETE_PLAYLIST,
    payload: { playlists }
  });
};

export const loadLocalPlaylists = () => dispatch => {
  const playlists = store.get('playlists');

  dispatch({
    type: Playlists.LOAD_LOCAL_PLAYLISTS,
    payload: { playlists: _.defaultTo(playlists, []) }
  });
};

export const loadRemotePlaylistsAction = createAsyncAction(
  Playlists.LOAD_REMOTE_PLAYLISTS_START,
  Playlists.LOAD_REMOTE_PLAYLISTS_SUCCESS,
  Playlists.LOAD_REMOTE_PLAYLISTS_ERROR
)<void, GetPlaylistsByUserIdResponseBody, ErrorBody>();

export const loadRemotePlaylists = ({ token, signedInUser }: IdentityStore) => async (dispatch, getState) => {
  dispatch(loadRemotePlaylistsAction.request());
  const { settings } = getState();
  const service = new rest.NuclearPlaylistsService(
    settings.nuclearPlaylistsServiceUrl
  );

  try {
    if (token) {
      const playlists = await service.getPlaylistsByUserId(token, signedInUser.id);
      if (playlists.ok) {
        dispatch(loadRemotePlaylistsAction.success(playlists.body as GetPlaylistsByUserIdResponseBody));
      } else {
        dispatch(loadRemotePlaylistsAction.failure(playlists.body as ErrorBody));
      }
    }
  } catch (e) {
    dispatch(loadRemotePlaylistsAction.failure(e.message));
  }
};

export const updatePlaylist = (playlist: Playlist) => dispatch => {
  const playlists = updatePlaylistEffect(store)(playlist);
  dispatch({
    type: Playlists.UPDATE_PLAYLIST,
    payload: { playlists }
  });
};

export const reorderPlaylists = (source: number, destination: number) => async (dispatch) => {
  const playlists = updatePlaylistsOrderEffect(store)(source, destination);
  dispatch({
    type: Playlists.UPDATE_PLAYLIST,
    payload: { playlists }
  });
};


export const exportPlaylist = (playlist, t) => async (dispatch) => {
  const name = playlist.name;
  const dialogResult = await remote.dialog.showSaveDialog({
    defaultPath: name,
    filters: [
      { name: 'file', extensions: ['json'] }
    ],
    properties: ['createDirectory', 'showOverwriteConfirmation']
  });
  const filePath = dialogResult?.filePath?.replace(/\\/g, '/');

  if (filePath) {
    try {
      const data = JSON.stringify(playlist, null, 2);
      fs.writeFile(filePath, data, (err) => {
        if (err) {
          dispatch(error(t('export-fail-title'), t('error-save-file'), null, null));
          return;
        }
        dispatch(success(t('export-success-title'), t('playlist-exported', { name }), null, null));
      });
    } catch (e) {
      dispatch(error(t('export-fail-title'), t('error-save-file'), null, null));
    }

  }
};

export function addPlaylistFromFile(filePath, t) {
  return async dispatch => {
    fs.readFile(filePath, (err, data) => {
      if (err) {
        dispatch(error(t('import-fail-title'), t('error-open-file'), null, null));
        return;
      }

      try {
        const parsed = JSON.parse(data.toString());
        const name = _.get(parsed, 'name', null);
        const tracks = _.get(parsed, 'tracks', null);
        const source = _.get(parsed, 'source', null);

        if (!name || !tracks) {
          throw new Error('missing tracks or name');
        }

        let playlists = store.get('playlists') || [];
        const playlist = PlaylistHelper.formatPlaylistForStorage(name, tracks, v4(), source);

        if (_.isEmpty(tracks)) {
          dispatch(error(t('import-fail-title'), t('error-empty-data'), null, null));
          return;
        }

        playlists = [...playlists, playlist];

        store.set('playlists', playlists);
        dispatch(success(t('import-success-title'), t('playlist-created', { name }), null, null));
        dispatch({
          type: Playlists.ADD_PLAYLIST,
          payload: { playlists }
        });

      } catch (e) {
        dispatch(error(t('import-fail-title'), t('error-invalid-data'), null, null));
      }
    });
  };
}
