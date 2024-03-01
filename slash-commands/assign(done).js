const { GoogleSpreadsheet } = require('google-spreadsheet');
const { readFileSync } = require('fs');
require('dotenv').config();
const { JWT } = require('google-auth-library');

module.exports = {
  run: async ({ interaction, args }) => {
    // Check if the interaction is within a thread
    if (!interaction.channel.isThread()) {
      await interaction.reply({ content: 'This command can only be used within a thread.', ephemeral: true });
      return;
    }

    // Check if a username was provided
    let assignedUser = interaction.options.getString('username');
    if (!assignedUser) {
      // Immediately reply that a username is required
      await interaction.reply({ content: 'You didn\'t fill in a username.', ephemeral: true });
      return;
    }

    // Immediately defer the reply to buy time
    await interaction.deferReply({ ephemeral: true });

    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const hasRole = member.roles.cache.has(process.env.TEAM_ROLE_ID);
      
      if (!hasRole) {
        // Edit the original deferred reply with an error message
        await interaction.editReply({ content: 'You do not have permission to use this command.' });
        return;
      }

      const creds = JSON.parse(readFileSync(process.env.GOOGLE_SHEETS_CREDENTIALS_PATH, 'utf8'));
      const serviceAccountAuth = new JWT({
        email: creds.client_email,
        key: creds.private_key.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/calendar'],
      });

      const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
      await doc.loadInfo();
      const sheet = doc.sheetsByIndex[0]; // Use the first sheet

      const threadId = interaction.channelId; // Get the thread ID

      const rows = await sheet.getRows();

      // Find the row with the matching thread ID in column H (index 7)
      const rowToEdit = rows.find(row => row._rawData[7] === threadId);

      if (rowToEdit) {
        rowToEdit._rawData[8] = assignedUser; // Update column I (index 8) with the assignee
        await rowToEdit.save();
        // Edit the original deferred reply with the success message
        await interaction.editReply(`The thread has been assigned to ${assignedUser}.`);

        // Assuming the thread name format is "Project Name - ❌" and you want to change it to "Project Name - ⏳"
        const currentThreadName = interaction.channel.name;
        const newThreadName = currentThreadName.replace('❌', '⏳');
        await interaction.channel.setName(newThreadName); // Rename the thread

        // New code to update the calendar event
        const calendarEventId = rowToEdit._rawData[10]; // Get the CalendarEventId from column K (index 10)
        const {google} = require('googleapis');
        const calendar = google.calendar({version: 'v3', auth: serviceAccountAuth});

        try {
          // Fetch the calendar event
          const event = await calendar.events.get({
            calendarId: process.env.GOOGLE_CALENDAR_ID, // Use the calendar ID from environment variables
            eventId: calendarEventId,
          });

          // Update the event's title to include the username
          event.data.summary = `${event.data.summary} - Assigned to ${assignedUser}`;

          // Save the updated event
          await calendar.events.update({
            calendarId: process.env.GOOGLE_CALENDAR_ID, // Use the calendar ID from environment variables again
            eventId: calendarEventId,
            requestBody: event.data,
          });

          console.log('Calendar event updated successfully.');
        } catch (error) {
          console.error('Error updating calendar event:', error);
        }
      } else {
        // Edit the original deferred reply with the error message
        await interaction.editReply('No matching row found for this thread.');
      }
    } catch (err) {
      console.error('Error updating Google Sheets:', err);
      // Edit the original deferred reply with the error message
      await interaction.editReply('There was an error updating the data. Please try again.');
    }
  },

  data: {
    name: 'assign',
    description: 'Assigns the specified username to the row associated with the thread ID in the Google Sheet.',
    options: [
      {
        name: 'username',
        type: 3, // STRING type
        description: 'The username to assign',
        required: true, // Set to true if you want this to be a required field
      },
    ],
  },
};