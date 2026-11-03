package accounts

import (
	"errors"
	"log"
	"net/http"
	"strconv"
)

// Moderation for the operator's admin page: list, rename and remove player
// accounts. Every route here must be wrapped in the admin session check by
// the caller (main does, with admin.RequireSession).

// RegisterAdmin mounts the moderation routes; wrap applies the admin gate.
func (a *API) RegisterAdmin(mux *http.ServeMux, wrap func(http.HandlerFunc) http.HandlerFunc) {
	mux.HandleFunc("/admin/api/users", wrap(a.handleAdminList))
	mux.HandleFunc("/admin/api/users/rename", wrap(a.post(a.handleAdminRename)))
	mux.HandleFunc("/admin/api/users/delete", wrap(a.post(a.handleAdminDelete)))
}

func (a *API) handleAdminList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	limit := 50
	if n, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && n > 0 && n <= 200 {
		limit = n
	}
	users, err := a.store.ListUsers(r.URL.Query().Get("q"), limit)
	if err != nil {
		log.Printf("admin: list users: %v", err)
		writeError(w, http.StatusInternalServerError, "could not list players")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users})
}

func (a *API) handleAdminRename(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID       int64  `json:"id"`
		Username string `json:"username"`
	}
	if !decode(w, r, &body) {
		return
	}
	switch err := a.store.Rename(body.ID, body.Username); {
	case errors.Is(err, ErrUsernameInvalid):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, ErrUsernameTaken):
		writeError(w, http.StatusConflict, "that username is taken")
	case errors.Is(err, ErrNoUser):
		writeError(w, http.StatusNotFound, "no such player")
	case err != nil:
		log.Printf("admin: rename %d: %v", body.ID, err)
		writeError(w, http.StatusInternalServerError, "could not rename")
	default:
		log.Printf("admin: renamed account %d", body.ID)
		w.WriteHeader(http.StatusNoContent)
	}
}

func (a *API) handleAdminDelete(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID int64 `json:"id"`
	}
	if !decode(w, r, &body) {
		return
	}
	switch err := a.store.DeleteUser(body.ID); {
	case errors.Is(err, ErrNoUser):
		writeError(w, http.StatusNotFound, "no such player")
	case err != nil:
		log.Printf("admin: delete %d: %v", body.ID, err)
		writeError(w, http.StatusInternalServerError, "could not remove")
	default:
		if a.OnLogout != nil {
			a.OnLogout(body.ID)
		}
		log.Printf("admin: removed account %d", body.ID)
		w.WriteHeader(http.StatusNoContent)
	}
}
