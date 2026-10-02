// vibi-tui: the interactive picker behind `vibi push`.
//
// Derived from subconscious-cli's subc-tui (MIT). Node writes a state file,
// streams patches through an updates file, and this program writes a request
// file whenever the user picks Sync or Send; Node performs the upload and
// answers through the updates file, so the picker stays open.
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

const updatesPollInterval = 80 * time.Millisecond

var spinnerFrames = []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"}

const (
	brandOrange = "#FF5C27"
	textColor   = "#F3EFEA"
	mutedColor  = "#8B8580"
	faintColor  = "#4E4945"
	greenColor  = "#6FD49A"
	redColor    = "#FF6B6B"
)

type sessionState struct {
	Key         string `json:"key"`
	Harness     string `json:"harness"`
	HarnessName string `json:"harnessName"`
	Title       string `json:"title"`
	Cwd         string `json:"cwd"`
	UpdatedAt   string `json:"updatedAt"`
	Model       string `json:"model"`
	Status      string `json:"status"`
	Label       string `json:"label"`
	SizeBytes   int64  `json:"sizeBytes"`
}

// A version of a remote session, for the pull picker.
type remoteVersion struct {
	ID     int    `json:"id"`
	Label  string `json:"label"`
	Latest bool   `json:"latest"`
}

// A session stored on the server (own or sent to this user), for `vibi pull`.
type remoteState struct {
	ID        string          `json:"id"` // "#20" or "s5": what `vibi pull <id>` takes
	Title     string          `json:"title"`
	Label     string          `json:"label"`
	Meta      string          `json:"meta"`
	UpdatedAt string          `json:"updatedAt"`
	Installed bool            `json:"installed"`
	Versions  []remoteVersion `json:"versions"`
}

type inputState struct {
	Version         string         `json:"version"`
	Mode            string         `json:"mode"` // "push" or "pull"
	Cwd             string         `json:"cwd"`
	ServerURL       string         `json:"serverUrl"`
	MachineName     string         `json:"machineName"`
	KeyUnlocked     bool           `json:"keyUnlocked"`
	SessionsLoading bool           `json:"sessionsLoading"`
	Sessions        []sessionState `json:"sessions"`
	Contacts        []string       `json:"contacts"`
	Remote          []remoteState  `json:"remote"`
}

type progressState struct {
	Phase  string `json:"phase"`
	Loaded int64  `json:"loaded"`
	Total  int64  `json:"total"`
}

type requestResult struct {
	Status   string         `json:"status"`
	Message  string         `json:"message"`
	Progress *progressState `json:"progress"`
}

var phaseLabels = map[string]string{
	"reading":     "Reading the session",
	"encrypting":  "Encrypting",
	"registering": "Registering with the server",
	"uploading":   "Uploading",
	"verifying":   "Verifying the upload",
	"downloading": "Downloading",
	"decrypting":  "Decrypting",
	"installing":  "Installing",
	"done":        "Done",
}

type statePatch struct {
	Sessions        *[]sessionState          `json:"sessions"`
	SessionsLoading *bool                    `json:"sessionsLoading"`
	Contacts        *[]string                `json:"contacts"`
	Remote          *[]remoteState           `json:"remote"`
	Requests        map[string]requestResult `json:"requests"`
}

type outRequest struct {
	ID        string `json:"id"`
	Action    string `json:"action"` // sync | send | pull
	Key       string `json:"key"`    // push: session key; pull: remote id
	Name      string `json:"name"`
	Email     string `json:"email"`
	VersionID int    `json:"versionId,omitempty"`
}

type updatesTickMsg struct{}

type screen int

const (
	screenSessions screen = iota
	screenAction
	screenName
	screenEmail
	screenBusy
	screenRemote
	screenVersions
)

var actionItems = []string{
	"Sync — encrypt for yourself and upload",
	"Send — encrypt for another user and send",
	"Back",
}

type model struct {
	state          inputState
	screen         screen
	cursor         int
	actionCursor   int
	selected       int
	remoteCursor   int
	versionCursor  int
	selectedRemote int
	mode           string
	nameInput      string
	nameCursor     int
	emailInput     string
	emailCursor    int
	inputError     string
	notice         string
	noticeIsError  bool
	busyID         string
	busyText       string
	seq            int
	width          int
	height         int
	updatesPath    string
	requestPath    string
	spinnerFrame   int
	lastUpdatesMod time.Time
	requests       map[string]requestResult
}

func newModel(state inputState) model {
	m := model{state: state, requests: map[string]requestResult{}}
	if state.Mode == "pull" {
		m.screen = screenRemote
	}
	return m
}

func (m model) homeScreen() screen {
	if m.state.Mode == "pull" {
		return screenRemote
	}
	return screenSessions
}

func clampCursor(cursor, length int) int {
	if length <= 0 {
		return 0
	}
	if cursor >= length {
		return length - 1
	}
	if cursor < 0 {
		return 0
	}
	return cursor
}

func wrapIndex(index, length int) int {
	if length <= 0 {
		return 0
	}
	if index < 0 {
		return length - 1
	}
	if index >= length {
		return 0
	}
	return index
}

func ellipsize(value string, width int) string {
	if width <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= width {
		return value
	}
	if width == 1 {
		return "…"
	}
	return string(runes[:width-1]) + "…"
}

func wrapText(value string, width int) string {
	if width <= 0 {
		return value
	}
	words := strings.Fields(value)
	if len(words) == 0 {
		return ""
	}
	var lines []string
	line := words[0]
	for _, word := range words[1:] {
		if utf8.RuneCountInString(line)+1+utf8.RuneCountInString(word) <= width {
			line += " " + word
			continue
		}
		lines = append(lines, line)
		line = word
	}
	return strings.Join(append(lines, line), "\n")
}

func sessionWhen(value string) string {
	if len(value) >= 16 {
		return strings.Replace(value[:16], "T", " ", 1)
	}
	return value
}

func formatSize(bytes int64) string {
	switch {
	case bytes >= 1024*1024:
		return fmt.Sprintf("%.1f MB", float64(bytes)/1024/1024)
	case bytes >= 1024:
		return fmt.Sprintf("%d KB", bytes/1024)
	case bytes > 0:
		return fmt.Sprintf("%d B", bytes)
	}
	return ""
}

// ---------------------------------------------------------------------------
// updates file polling (from subc)
// ---------------------------------------------------------------------------

func readStatePatch(path string, lastMod *time.Time) (statePatch, bool) {
	info, err := os.Stat(path)
	if err != nil {
		return statePatch{}, false
	}
	if !info.ModTime().After(*lastMod) {
		return statePatch{}, false
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return statePatch{}, false
	}
	var patch statePatch
	if err := json.Unmarshal(data, &patch); err != nil {
		return statePatch{}, false
	}
	*lastMod = info.ModTime()
	return patch, true
}

func applyStatePatch(m model, patch statePatch) model {
	if patch.Sessions != nil {
		m.state.Sessions = *patch.Sessions
	}
	if patch.SessionsLoading != nil {
		m.state.SessionsLoading = *patch.SessionsLoading
	}
	if patch.Contacts != nil {
		m.state.Contacts = *patch.Contacts
	}
	if patch.Remote != nil {
		m.state.Remote = *patch.Remote
	}
	for id, result := range patch.Requests {
		m.requests[id] = result
	}
	m.cursor = clampCursor(m.cursor, len(m.state.Sessions))
	m.selected = clampCursor(m.selected, len(m.state.Sessions))
	m.remoteCursor = clampCursor(m.remoteCursor, len(m.state.Remote))
	m.selectedRemote = clampCursor(m.selectedRemote, len(m.state.Remote))
	return m
}

func (m model) spinner() string {
	return spinnerFrames[m.spinnerFrame%len(spinnerFrames)]
}

func tickUpdates() tea.Cmd {
	return tea.Tick(updatesPollInterval, func(time.Time) tea.Msg { return updatesTickMsg{} })
}

func (m model) Init() tea.Cmd {
	return tickUpdates()
}

// ---------------------------------------------------------------------------
// requests to Node
// ---------------------------------------------------------------------------

func writeRequest(path string, request outRequest) error {
	if path == "" {
		return errors.New("no request path")
	}
	data, err := json.Marshal(request)
	if err != nil {
		return err
	}
	tmp := fmt.Sprintf("%s.%d.tmp", path, time.Now().UnixNano())
	if err := os.WriteFile(tmp, append(data, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (m model) dispatch(request outRequest, busyText string) (model, tea.Cmd) {
	m.seq++
	request.ID = fmt.Sprintf("%d-%d", os.Getpid(), m.seq)
	if err := writeRequest(m.requestPath, request); err != nil {
		m.notice = "Could not hand the request to vibi: " + err.Error()
		m.noticeIsError = true
		m.screen = m.homeScreen()
		return m, nil
	}
	m.busyID = request.ID
	m.busyText = busyText
	m.screen = screenBusy
	return m, nil
}

func (m model) submit(action, email string) (model, tea.Cmd) {
	if m.selected >= len(m.state.Sessions) {
		m.screen = screenSessions
		return m, nil
	}
	session := m.state.Sessions[m.selected]
	busy := "Syncing " + ellipsize(session.Title, 40)
	if action == "send" {
		busy = "Sending " + ellipsize(session.Title, 40) + " to " + email
	}
	return m.dispatch(outRequest{Action: action, Key: session.Key, Name: strings.TrimSpace(m.nameInput), Email: email}, busy)
}

func (m model) submitPull(versionID int) (model, tea.Cmd) {
	if m.selectedRemote >= len(m.state.Remote) {
		m.screen = screenRemote
		return m, nil
	}
	remote := m.state.Remote[m.selectedRemote]
	busy := "Pulling " + ellipsize(remote.Title, 40)
	if versionID > 0 {
		busy += fmt.Sprintf(" (v%d)", versionID)
	}
	return m.dispatch(outRequest{Action: "pull", Key: remote.ID, VersionID: versionID}, busy)
}

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil
	case updatesTickMsg:
		m.spinnerFrame++
		if m.updatesPath != "" {
			if patch, ok := readStatePatch(m.updatesPath, &m.lastUpdatesMod); ok {
				m = applyStatePatch(m, patch)
			}
		}
		if m.screen == screenBusy {
			if result, ok := m.requests[m.busyID]; ok && result.Status != "running" && result.Status != "" {
				m.notice = result.Message
				m.noticeIsError = result.Status == "error"
				m.screen = m.homeScreen()
			}
		}
		return m, tickUpdates()
	case tea.KeyPressMsg:
		key := msg.String()
		if key == "ctrl+c" {
			return m, tea.Quit
		}
		switch m.screen {
		case screenAction:
			return m.updateAction(key)
		case screenName:
			return m.updateName(msg)
		case screenEmail:
			return m.updateEmail(msg)
		case screenBusy:
			return m, nil
		case screenRemote:
			return m.updateRemote(key)
		case screenVersions:
			return m.updateVersions(key)
		default:
			return m.updateSessions(key)
		}
	}
	return m, nil
}

func (m model) updateSessions(key string) (tea.Model, tea.Cmd) {
	switch key {
	case "q", "esc":
		return m, tea.Quit
	case "up", "k":
		m.cursor = wrapIndex(m.cursor-1, len(m.state.Sessions))
	case "down", "j":
		m.cursor = wrapIndex(m.cursor+1, len(m.state.Sessions))
	case "enter":
		if len(m.state.Sessions) == 0 {
			return m, nil
		}
		m.selected = m.cursor
		m.actionCursor = 0
		m.notice = ""
		m.screen = screenAction
	}
	return m, nil
}

func (m model) updateAction(key string) (tea.Model, tea.Cmd) {
	switch key {
	case "q", "esc":
		m.screen = screenSessions
	case "up", "k":
		m.actionCursor = wrapIndex(m.actionCursor-1, len(actionItems))
	case "down", "j":
		m.actionCursor = wrapIndex(m.actionCursor+1, len(actionItems))
	case "enter":
		switch m.actionCursor {
		case 0, 1:
			if m.actionCursor == 0 {
				m.mode = "sync"
			} else {
				m.mode = "send"
			}
			m.nameInput = m.state.Sessions[m.selected].Label
			m.nameCursor = utf8.RuneCountInString(m.nameInput)
			m.inputError = ""
			m.screen = screenName
		default:
			m.screen = screenSessions
		}
	}
	return m, nil
}

func (m model) updateRemote(key string) (tea.Model, tea.Cmd) {
	switch key {
	case "q", "esc":
		return m, tea.Quit
	case "up", "k":
		m.remoteCursor = wrapIndex(m.remoteCursor-1, len(m.state.Remote))
	case "down", "j":
		m.remoteCursor = wrapIndex(m.remoteCursor+1, len(m.state.Remote))
	case "enter":
		if len(m.state.Remote) == 0 {
			return m, nil
		}
		m.selectedRemote = m.remoteCursor
		m.notice = ""
		remote := m.state.Remote[m.selectedRemote]
		if len(remote.Versions) > 1 {
			m.versionCursor = 0
			m.screen = screenVersions
			return m, nil
		}
		if len(remote.Versions) == 1 {
			return m.submitPull(remote.Versions[0].ID)
		}
		return m.submitPull(0)
	}
	return m, nil
}

func (m model) updateVersions(key string) (tea.Model, tea.Cmd) {
	remote := m.state.Remote[m.selectedRemote]
	switch key {
	case "q", "esc":
		m.screen = screenRemote
	case "up", "k":
		m.versionCursor = wrapIndex(m.versionCursor-1, len(remote.Versions))
	case "down", "j":
		m.versionCursor = wrapIndex(m.versionCursor+1, len(remote.Versions))
	case "enter":
		if len(remote.Versions) == 0 {
			return m, nil
		}
		return m.submitPull(remote.Versions[m.versionCursor].ID)
	}
	return m, nil
}

// editLine applies line-editing keys to value/cursor; handled reports whether
// the key was consumed (enter is left to the caller).
func editLine(msg tea.KeyPressMsg, value string, cursor int, limit int) (handled bool, next string, nextCursor int) {
	switch msg.String() {
	case "left", "ctrl+b":
		if cursor > 0 {
			cursor--
		}
		return true, value, cursor
	case "right", "ctrl+f":
		if cursor < utf8.RuneCountInString(value) {
			cursor++
		}
		return true, value, cursor
	case "home", "ctrl+a":
		return true, value, 0
	case "end", "ctrl+e":
		return true, value, utf8.RuneCountInString(value)
	case "backspace", "ctrl+h":
		value, cursor = deleteBeforeCursor(value, cursor)
		return true, value, cursor
	case "delete":
		value, cursor = deleteAtCursor(value, cursor)
		return true, value, cursor
	case "ctrl+u":
		return true, "", 0
	case "enter", "esc":
		return false, value, cursor
	default:
		text := msg.Key().Text
		if text != "" {
			value, cursor = insertAtCursor(value, cursor, text, limit)
		}
		return true, value, cursor
	}
}

func insertAtCursor(value string, cursor int, text string, limit int) (string, int) {
	runes := []rune(value)
	if cursor > len(runes) {
		cursor = len(runes)
	}
	if cursor < 0 {
		cursor = 0
	}
	insert := []rune(text)
	if len(runes)+len(insert) > limit {
		return value, cursor
	}
	next := make([]rune, 0, len(runes)+len(insert))
	next = append(next, runes[:cursor]...)
	next = append(next, insert...)
	next = append(next, runes[cursor:]...)
	return string(next), cursor + len(insert)
}

func deleteBeforeCursor(value string, cursor int) (string, int) {
	runes := []rune(value)
	if cursor > len(runes) {
		cursor = len(runes)
	}
	if cursor <= 0 || len(runes) == 0 {
		return value, 0
	}
	next := append([]rune{}, runes[:cursor-1]...)
	next = append(next, runes[cursor:]...)
	return string(next), cursor - 1
}

func deleteAtCursor(value string, cursor int) (string, int) {
	runes := []rune(value)
	if cursor < 0 {
		cursor = 0
	}
	if cursor >= len(runes) {
		return value, len(runes)
	}
	next := append([]rune{}, runes[:cursor]...)
	next = append(next, runes[cursor+1:]...)
	return string(next), cursor
}

func (m model) updateName(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	if handled, value, cursor := editLine(msg, m.nameInput, m.nameCursor, 200); handled {
		m.nameInput, m.nameCursor = value, cursor
		return m, nil
	}
	switch msg.String() {
	case "esc":
		m.screen = screenAction
	case "enter":
		if m.mode == "send" {
			if m.emailInput == "" && len(m.state.Contacts) > 0 {
				m.emailInput = m.state.Contacts[0]
			}
			m.emailCursor = utf8.RuneCountInString(m.emailInput)
			m.inputError = ""
			m.screen = screenEmail
			return m, nil
		}
		return m.submit("sync", "")
	}
	return m, nil
}

func looksLikeEmail(value string) bool {
	at := strings.Index(value, "@")
	return at > 0 && strings.Contains(value[at:], ".") && !strings.ContainsAny(value, " \t")
}

func (m model) updateEmail(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	if handled, value, cursor := editLine(msg, m.emailInput, m.emailCursor, 254); handled {
		m.emailInput, m.emailCursor = value, cursor
		m.inputError = ""
		return m, nil
	}
	switch msg.String() {
	case "esc":
		m.screen = screenName
	case "enter":
		email := strings.ToLower(strings.TrimSpace(m.emailInput))
		if !looksLikeEmail(email) {
			m.inputError = "Enter the recipient's email address."
			return m, nil
		}
		return m.submit("send", email)
	}
	return m, nil
}

// ---------------------------------------------------------------------------
// view
// ---------------------------------------------------------------------------

func (m model) View() tea.View {
	var content string
	switch m.screen {
	case screenAction:
		content = m.renderAction()
	case screenName:
		content = m.renderName()
	case screenEmail:
		content = m.renderEmail()
	case screenBusy:
		content = m.renderBusy()
	case screenRemote:
		content = m.renderRemote()
	case screenVersions:
		content = m.renderVersions()
	default:
		content = m.renderSessions()
	}
	view := tea.NewView(content)
	view.AltScreen = true
	view.WindowTitle = "vibi " + map[bool]string{true: "pull", false: "push"}[m.state.Mode == "pull"]
	return view
}

func style(color string) lipgloss.Style {
	return lipgloss.NewStyle().Foreground(lipgloss.Color(color))
}

func (m model) panel(width int, body string) string {
	frame := lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(lipgloss.Color(brandOrange)).Padding(1, 2).Width(width).Render(body)
	return lipgloss.Place(max(width+4, m.width), max(12, m.height), lipgloss.Center, lipgloss.Center, frame)
}

func statusLabel(status string) string {
	switch status {
	case "synced":
		return style(greenColor).Render("synced")
	case "changed":
		return style(brandOrange).Render("changed")
	default:
		return style(brandOrange).Render("new")
	}
}

func (m model) renderSessions() string {
	width := min(max(60, m.width-8), 110)
	innerWidth := width - 6
	visible := max(5, m.height-16)
	visible = min(visible, len(m.state.Sessions))
	start := max(0, m.cursor-visible/2)
	if start+visible > len(m.state.Sessions) {
		start = max(0, len(m.state.Sessions)-visible)
	}
	end := min(len(m.state.Sessions), start+visible)
	metaWidth := min(34, max(20, innerWidth/3))
	labelWidth := max(16, innerWidth-metaWidth-4)

	rows := []string{}
	for index := start; index < end; index++ {
		session := m.state.Sessions[index]
		title := session.Title
		if session.Label != "" {
			title = "[" + session.Label + "] " + title
		}
		meta := session.HarnessName + " · " + sessionWhen(session.UpdatedAt) + " · " + session.Status
		row := fmt.Sprintf("  %-*s  %-*s", labelWidth, ellipsize(title, labelWidth), metaWidth, ellipsize(meta, metaWidth))
		if index == m.cursor {
			row = lipgloss.NewStyle().Foreground(lipgloss.Color("#111111")).Background(lipgloss.Color(brandOrange)).Bold(true).Width(innerWidth).Render("› " + strings.TrimPrefix(row, "  "))
		} else {
			row = style(textColor).Width(innerWidth).Render(row)
		}
		rows = append(rows, row)
	}
	if len(rows) == 0 {
		empty := "No Claude Code, Codex, OpenCode, Pi, or Marathon sessions were started in this directory."
		if m.state.SessionsLoading {
			empty = m.spinner() + " Scanning sessions..."
		}
		rows = append(rows, style(mutedColor).Render(wrapText(empty, innerWidth)))
	}

	heading := style(brandOrange).Bold(true).Render("✻  vibi push") + "  " + style(mutedColor).Render("v"+m.state.Version)
	keyState := style(greenColor).Render("● key unlocked")
	if !m.state.KeyUnlocked {
		keyState = style(mutedColor).Render("○ key locked (uploads still work)")
	}
	info := style(textColor).Render(ellipsize(m.state.Cwd, width-4)) + "\n" +
		style(mutedColor).Render(ellipsize(m.state.MachineName+" · "+m.state.ServerURL, width-4)) + "  " + keyState
	copy := style(mutedColor).Render("Choose a session, then Sync it to your account or Send it to another user.")
	if len(m.state.Sessions) > 0 {
		selected := m.state.Sessions[m.cursor]
		details := selected.HarnessName
		if selected.Model != "" {
			details += " · " + selected.Model
		}
		if size := formatSize(selected.SizeBytes); size != "" {
			details += " · " + size
		}
		details += " · " + statusLabel(selected.Status)
		if selected.Cwd != "" && selected.Cwd != m.state.Cwd {
			details += "\n" + ellipsize(selected.Cwd, width-4)
		}
		copy += "\n\n" + style(textColor).Render(details)
	}
	if len(m.state.Sessions) > visible {
		copy += "\n" + style(mutedColor).Render(fmt.Sprintf("Showing %d–%d of %d", start+1, end, len(m.state.Sessions)))
	}
	footer := style(mutedColor).Render("↑/↓ navigate   enter choose   q quit")
	if m.notice != "" {
		mark, color := "✓ ", greenColor
		if m.noticeIsError {
			mark, color = "✗ ", redColor
		}
		footer = style(color).Render(mark+wrapText(m.notice, width-6)) + "\n" + footer
	}
	return m.panel(width, heading+"\n"+info+"\n\n"+copy+"\n\n"+strings.Join(rows, "\n")+"\n\n"+footer)
}

func (m model) renderRemote() string {
	width := min(max(60, m.width-8), 110)
	innerWidth := width - 6
	visible := max(5, m.height-16)
	visible = min(visible, len(m.state.Remote))
	start := max(0, m.remoteCursor-visible/2)
	if start+visible > len(m.state.Remote) {
		start = max(0, len(m.state.Remote)-visible)
	}
	end := min(len(m.state.Remote), start+visible)
	idWidth := 5
	metaWidth := min(40, max(22, innerWidth/3))
	labelWidth := max(16, innerWidth-idWidth-metaWidth-6)

	rows := []string{}
	for index := start; index < end; index++ {
		remote := m.state.Remote[index]
		title := remote.Title
		if remote.Label != "" {
			title = "[" + remote.Label + "] " + title
		}
		meta := remote.Meta
		if remote.Installed {
			meta = "installed · " + meta
		}
		row := fmt.Sprintf("  %-*s %-*s  %-*s", idWidth, ellipsize(remote.ID, idWidth), labelWidth, ellipsize(title, labelWidth), metaWidth, ellipsize(meta, metaWidth))
		if index == m.remoteCursor {
			row = lipgloss.NewStyle().Foreground(lipgloss.Color("#111111")).Background(lipgloss.Color(brandOrange)).Bold(true).Width(innerWidth).Render("› " + strings.TrimPrefix(row, "  "))
		} else {
			row = style(textColor).Width(innerWidth).Render(row)
		}
		rows = append(rows, row)
	}
	if len(rows) == 0 {
		empty := "No sessions stored for this account yet. Run `vibi push` in a project directory on any machine first."
		if m.state.SessionsLoading {
			empty = m.spinner() + " Loading sessions..."
		}
		rows = append(rows, style(mutedColor).Render(wrapText(empty, innerWidth)))
	}

	heading := style(brandOrange).Bold(true).Render("✻  vibi pull") + "  " + style(mutedColor).Render("v"+m.state.Version)
	keyState := style(greenColor).Render("● key unlocked")
	if !m.state.KeyUnlocked {
		keyState = style(redColor).Render("○ key locked: run `vibi unlock` before pulling")
	}
	info := style(textColor).Render("Install into "+ellipsize(m.state.Cwd, width-18)) + "\n" +
		style(mutedColor).Render(ellipsize(m.state.MachineName+" · "+m.state.ServerURL, width-4)) + "  " + keyState
	copy := style(mutedColor).Render("Newest first. #id are your sessions, s<id> were sent to you; the id is what `vibi pull <id>` takes.")
	if len(m.state.Remote) > 0 {
		selected := m.state.Remote[m.remoteCursor]
		details := selected.Meta
		if n := len(selected.Versions); n > 1 {
			details += fmt.Sprintf("\n%d versions: enter opens the version picker", n)
		}
		copy += "\n\n" + style(textColor).Render(details)
	}
	if len(m.state.Remote) > visible {
		copy += "\n" + style(mutedColor).Render(fmt.Sprintf("Showing %d–%d of %d", start+1, end, len(m.state.Remote)))
	}
	footer := style(mutedColor).Render("↑/↓ navigate   enter pull here   q quit")
	if m.notice != "" {
		mark, color := "✓ ", greenColor
		if m.noticeIsError {
			mark, color = "✗ ", redColor
		}
		footer = style(color).Render(mark+wrapText(m.notice, width-6)) + "\n" + footer
	}
	return m.panel(width, heading+"\n"+info+"\n\n"+copy+"\n\n"+strings.Join(rows, "\n")+"\n\n"+footer)
}

func (m model) renderVersions() string {
	remote := m.state.Remote[m.selectedRemote]
	items := make([]string, 0, len(remote.Versions))
	for _, v := range remote.Versions {
		label := v.Label
		if v.Latest {
			label += "  (latest)"
		}
		items = append(items, label)
	}
	title := remote.Title
	if remote.Label != "" {
		title = "[" + remote.Label + "] " + title
	}
	return m.renderPicker("Version of "+ellipsize(title, 40), items, m.versionCursor, "Choose which version to install into "+m.state.Cwd+". Contents stay encrypted on the server; only sizes and dates are known there.")
}

func (m model) renderPicker(title string, items []string, cursor int, description string) string {
	width := min(max(44, m.width-8), 80)
	var rows []string
	for index, item := range items {
		label := ellipsize(item, width-6)
		if index == cursor {
			rows = append(rows, lipgloss.NewStyle().Foreground(lipgloss.Color("#111111")).Background(lipgloss.Color(brandOrange)).Bold(true).Width(width-4).Render("› "+label))
		} else {
			rows = append(rows, style(textColor).Width(width-4).Render("  "+label))
		}
	}
	heading := style(brandOrange).Bold(true).Render("✻  " + title)
	copy := style(mutedColor).Render(wrapText(description, width-4))
	footer := style(mutedColor).Render("↑/↓ navigate   enter select   esc back")
	return m.panel(width, heading+"\n"+copy+"\n\n"+strings.Join(rows, "\n")+"\n\n"+footer)
}

func (m model) renderAction() string {
	session := m.state.Sessions[m.selected]
	description := session.HarnessName + " · " + sessionWhen(session.UpdatedAt)
	if session.Cwd != "" {
		description += "\n" + session.Cwd
	}
	if session.Status == "synced" {
		description += "\nAlready synced; Sync again only updates the name, Send re-keys the stored copy for the recipient."
	}
	return m.renderPicker(ellipsize(session.Title, 48), actionItems, m.actionCursor, description)
}

func renderEditableValue(value string, cursor int, width int, placeholder string) string {
	if value == "" {
		return "▌" + style(faintColor).Render(ellipsize(placeholder, max(1, width-1)))
	}
	runes := []rune(value)
	cursor = clampCursor(cursor, len(runes)+1)
	if width <= 1 {
		return "▌"
	}
	visible := width - 1
	start := 0
	if len(runes) > visible {
		after := visible / 3
		start = cursor - (visible - after)
		if start < 0 {
			start = 0
		}
		if start > len(runes)-visible {
			start = len(runes) - visible
		}
	}
	end := min(len(runes), start+visible)
	if cursor < start {
		cursor = start
	}
	if cursor > end {
		cursor = end
	}
	return string(runes[start:cursor]) + "▌" + string(runes[cursor:end])
}

func (m model) renderInput(title, description, value string, cursor int, placeholder, footer string) string {
	width := min(max(44, m.width-8), 80)
	heading := style(brandOrange).Bold(true).Render("✻  " + title)
	copy := style(mutedColor).Render(wrapText(description, width-4))
	field := lipgloss.NewStyle().Foreground(lipgloss.Color(textColor)).Border(lipgloss.NormalBorder(), false, false, true, false).BorderForeground(lipgloss.Color(faintColor)).Width(width-4).Render(renderEditableValue(value, cursor, width-5, placeholder))
	body := heading + "\n" + copy + "\n\n" + field
	if m.inputError != "" {
		body += "\n" + style(redColor).Render(m.inputError)
	}
	return m.panel(width, body+"\n\n"+style(mutedColor).Render(footer))
}

func (m model) renderName() string {
	session := m.state.Sessions[m.selected]
	verb := "syncing"
	if m.mode == "send" {
		verb = "sending"
	}
	return m.renderInput(
		"Name this session (optional)",
		"A plain-text name shown in the dashboard"+map[bool]string{true: " and to the recipient", false: ""}[m.mode == "send"]+" before "+verb+" "+ellipsize(session.Title, 40)+". Leave it empty to keep the current name.",
		m.nameInput, m.nameCursor, "e.g. parser refactor", "enter continue   esc back   ctrl+u clear",
	)
}

func (m model) renderEmail() string {
	return m.renderInput(
		"Send to",
		"The recipient must already be a vibivibi user with an encryption key. The session is encrypted for their key before it leaves this machine.",
		m.emailInput, m.emailCursor, "name@example.com", "enter send   esc back",
	)
}

func progressBar(loaded, total int64, width int) string {
	if total <= 0 || width <= 0 {
		return ""
	}
	ratio := float64(loaded) / float64(total)
	if ratio > 1 {
		ratio = 1
	}
	filled := int(ratio*float64(width) + 0.5)
	return "[" + strings.Repeat("█", filled) + strings.Repeat("░", width-filled) + "] " + fmt.Sprintf("%d%%", int(ratio*100))
}

func (m model) renderBusy() string {
	width := min(max(48, m.width-8), 80)
	heading := style(brandOrange).Bold(true).Render("✻  " + m.busyText)
	phase := "Working"
	detail := ""
	if result, ok := m.requests[m.busyID]; ok && result.Progress != nil {
		if label, known := phaseLabels[result.Progress.Phase]; known {
			phase = label
		} else {
			phase = result.Progress.Phase
		}
		if result.Progress.Total > 0 {
			bar := progressBar(result.Progress.Loaded, result.Progress.Total, width-14)
			detail = style(brandOrange).Render(bar) + "\n" + style(mutedColor).Render(formatSize(result.Progress.Loaded)+" / "+formatSize(result.Progress.Total))
		}
	}
	lines := []string{heading, "", style(textColor).Render(m.spinner() + " " + phase + "...")}
	if detail != "" {
		lines = append(lines, detail)
	}
	lines = append(lines, "", style(mutedColor).Render("Stays here until the server has verified the result. ctrl+c closes the picker; a transfer in progress still finishes."))
	return m.panel(width, strings.Join(lines, "\n"))
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

func readState(path string) (inputState, error) {
	if path == "" {
		return inputState{}, errors.New("--state is required")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return inputState{}, err
	}
	var state inputState
	if err := json.Unmarshal(data, &state); err != nil {
		return inputState{}, err
	}
	return state, nil
}

func run() error {
	statePath := flag.String("state", "", "path to the input state JSON")
	updatesPath := flag.String("updates", "", "path to streamed state patches")
	requestPath := flag.String("request", "", "path to write user requests to")
	flag.Parse()

	state, err := readState(*statePath)
	if err != nil {
		return err
	}
	app := newModel(state)
	app.updatesPath = *updatesPath
	app.requestPath = *requestPath
	_, err = tea.NewProgram(app).Run()
	return err
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "vibi tui:", err)
		os.Exit(1)
	}
}
