package api

import (
	"net/http"

	"kartsim/internal/data/cache"
	"kartsim/internal/shared/apierr"
	"kartsim/internal/shared/contract"
	"kartsim/internal/shared/ticket"
)

var (
	errGameServerNotFound = apierr.New(http.StatusNotFound, "GAME_SERVER_NOT_FOUND")
	errGameServerFull     = apierr.New(http.StatusServiceUnavailable, "GAME_SERVER_FULL")
	errOnboardingRequired = apierr.New(http.StatusForbidden, "ONBOARDING_REQUIRED")
)

// nodeOrigin is the browser origin of a node; null means "same origin as
// the data service" (a reverse proxy routes /multiplayer/ws).
func nodeOrigin(node cache.Node) *string {
	if node.Origin == "" {
		return nil
	}
	origin := node.Origin
	return &origin
}

// gameServers lists the live game nodes.
func (a *API) gameServers(w http.ResponseWriter, r *http.Request) error {
	nodes, err := a.cluster.Nodes(r.Context())
	if err != nil {
		a.log.Warn("game server list unavailable", "error", err)
		return errServiceUnavailable
	}
	list := contract.GameServerList{DataNode: a.dataNode, Servers: make([]contract.GameServer, 0, len(nodes))}
	for _, node := range nodes {
		list.Servers = append(list.Servers, contract.GameServer{
			NodeID:   node.NodeID,
			Name:     node.Name,
			Origin:   nodeOrigin(node),
			Players:  node.Players,
			Rooms:    node.Rooms,
			Capacity: node.Capacity,
			Full:     node.Full(),
		})
	}
	return writeJSON(w, http.StatusOK, list)
}

// ticketClaims is who a ticket request comes from: a logged-in account that
// claimed the starter gift, or a guest when KART_ALLOW_GUESTS is set.
func (a *API) ticketClaims(r *http.Request) (ticket.Claims, error) {
	token := bearer(r)
	if token == nil {
		if !a.allowGuests {
			return ticket.Claims{}, errLoginRequired
		}
		return ticket.Claims{Guest: true}, nil
	}
	account, err := a.requireAccount(r.Context(), token)
	if err != nil {
		return ticket.Claims{}, err
	}
	onboarded, err := a.store.Onboarded(r.Context(), account.ID)
	if err != nil {
		return ticket.Claims{}, err
	}
	if !onboarded {
		return ticket.Claims{}, errOnboardingRequired
	}
	return ticket.Claims{AccountID: account.ID, Username: account.Username, Nickname: account.Nickname, GM: account.GM,
		Admin: account.Admin}, nil
}

// issueTicket signs a one-time entry ticket for one game node. A request
// with a Bearer token gets an account ticket and must be logged in, and the
// account must have claimed the starter gift (ECONOMY.md 2.3). Without a
// token it gets a guest ticket, only when KART_ALLOW_GUESTS is set.
func (a *API) issueTicket(w http.ResponseWriter, r *http.Request) error {
	var request contract.TicketRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return err
	}
	claims, err := a.ticketClaims(r)
	if err != nil {
		return err
	}
	if !validNodeID(request.NodeID) || request.NodeID == contract.LobbyNodeID {
		return errGameServerNotFound
	}
	node, found, err := a.cluster.Node(r.Context(), request.NodeID)
	if err != nil {
		a.log.Warn("game server lookup unavailable", "error", err)
		return errServiceUnavailable
	}
	if !found {
		return errGameServerNotFound
	}
	if node.Full() {
		return errGameServerFull
	}
	claims.NodeID = node.NodeID
	claims.DataNode = a.dataNode
	signed, issued := ticket.Sign(a.ticketKey(node), claims, a.now())
	return writeJSON(w, http.StatusOK, contract.TicketResponse{
		Ticket:    signed,
		NodeID:    node.NodeID,
		Origin:    nodeOrigin(node),
		DataNode:  a.dataNode,
		ExpiresAt: issued.ExpiresAt,
	})
}
